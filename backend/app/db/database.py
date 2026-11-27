"""
TiDB Cloud MySQL Database Integration for THERMA-LADAKH.
Manages persistent simulation history, design configurations, and materials database.
"""
import os
import json
import logging
from typing import Dict, Any, Optional, List
import pymysql
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)

# TiDB Cloud MySQL Configuration
TIDB_CONFIG = {
    "host": os.getenv("TIDB_HOST", "your_host_here"),
    "port": int(os.getenv("TIDB_PORT", "4000")),
    "user": os.getenv("TIDB_USER", "your_user_here"),
    "password": os.getenv("TIDB_PASSWORD", "your_password_here"),
    "database": os.getenv("TIDB_DATABASE", "your_db_here"),
    "ssl": {"ssl_mode": "REQUIRED"},
    "cursorclass": pymysql.cursors.DictCursor,
    "autocommit": True,
    "connect_timeout": 10,
}

def get_connection():
    """Create a secure SSL connection to TiDB Cloud MySQL."""
    return pymysql.connect(**TIDB_CONFIG)

def init_db():
    """Initialize tables in TiDB Cloud MySQL."""
    try:
        conn = get_connection()
        with conn.cursor() as cursor:
            # 1. Simulations Table
            cursor.execute("""
            CREATE TABLE IF NOT EXISTS simulations (
                id VARCHAR(64) PRIMARY KEY,
                variant_label VARCHAR(128),
                engine_used VARCHAR(64),
                status VARCHAR(32) DEFAULT 'queued',
                min_inside_temp_C DOUBLE,
                peak_inside_temp_C DOUBLE,
                avg_inside_temp_C DOUBLE,
                max_temp_diff_C DOUBLE,
                inside_temp_drop_C DOUBLE,
                efficiency_score DOUBLE,
                total_solar_kwh DOUBLE,
                total_heat_loss_kwh DOUBLE,
                comfort_hours INT,
                inputs_json LONGTEXT,
                results_json LONGTEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_created (created_at DESC),
                INDEX idx_status (status)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
            """)

            # 2. Multi-Variant Comparisons Table
            cursor.execute("""
            CREATE TABLE IF NOT EXISTS comparisons (
                id VARCHAR(64) PRIMARY KEY,
                status VARCHAR(32) DEFAULT 'queued',
                best_variant_label VARCHAR(128),
                recommendation_text TEXT,
                variants_count INT DEFAULT 0,
                comparison_data_json LONGTEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_comp_created (created_at DESC)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
            """)

            # 3. Materials Catalog Table
            cursor.execute("""
            CREATE TABLE IF NOT EXISTS materials_catalog (
                id VARCHAR(64) PRIMARY KEY,
                name VARCHAR(128) NOT NULL,
                category VARCHAR(64),
                conductivity DOUBLE NOT NULL,
                density DOUBLE NOT NULL,
                specific_heat DOUBLE NOT NULL,
                solar_absorptivity DOUBLE DEFAULT 0.7,
                embodied_carbon DOUBLE DEFAULT 0.0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
            """)
        conn.close()
        logger.info("TiDB Cloud MySQL initialized successfully.")
        return True
    except Exception as e:
        logger.warning(f"TiDB Cloud connection warning: {e}")
        return False

def save_simulation(job_id: str, shelter_input: Any, results: Dict[str, Any]) -> bool:
    """Save single simulation job and results to TiDB Cloud."""
    try:
        inp_dict = shelter_input.dict() if hasattr(shelter_input, "dict") else (shelter_input if isinstance(shelter_input, dict) else shelter_input.__dict__)
        variant_label = results.get("variant_label") or inp_dict.get("variant_label") or "Design"
        engine = results.get("engine_used") or "python_fdm"
        status = results.get("status") or "complete"

        min_t = results.get("min_inside_temp_C")
        peak_t = results.get("peak_inside_temp_C")
        avg_t = results.get("avg_inside_temp_C")
        max_diff = results.get("max_temp_diff_C")
        in_drop = results.get("inside_temp_drop_C")
        eff = results.get("efficiency_score")
        sol_kwh = results.get("total_solar_gain_kwh")
        loss_kwh = results.get("total_heat_loss_kwh")
        comfort = results.get("comfort_hours")

        conn = get_connection()
        with conn.cursor() as cursor:
            cursor.execute("""
            INSERT INTO simulations 
            (id, variant_label, engine_used, status, min_inside_temp_C, peak_inside_temp_C, avg_inside_temp_C,
             max_temp_diff_C, inside_temp_drop_C, efficiency_score, total_solar_kwh, total_heat_loss_kwh,
             comfort_hours, inputs_json, results_json)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON DUPLICATE KEY UPDATE
                status=VALUES(status),
                engine_used=VALUES(engine_used),
                min_inside_temp_C=VALUES(min_inside_temp_C),
                peak_inside_temp_C=VALUES(peak_inside_temp_C),
                avg_inside_temp_C=VALUES(avg_inside_temp_C),
                max_temp_diff_C=VALUES(max_temp_diff_C),
                inside_temp_drop_C=VALUES(inside_temp_drop_C),
                efficiency_score=VALUES(efficiency_score),
                total_solar_kwh=VALUES(total_solar_kwh),
                total_heat_loss_kwh=VALUES(total_heat_loss_kwh),
                comfort_hours=VALUES(comfort_hours),
                results_json=VALUES(results_json);
            """, (
                job_id, variant_label, engine, status,
                min_t, peak_t, avg_t, max_diff, in_drop, eff, sol_kwh, loss_kwh, comfort,
                json.dumps(inp_dict), json.dumps(results)
            ))
        conn.close()
        return True
    except Exception as e:
        logger.warning(f"Could not persist simulation to TiDB: {e}")
        return False

def get_simulation_from_db(job_id: str) -> Optional[Dict[str, Any]]:
    """Retrieve simulation result from TiDB Cloud."""
    try:
        conn = get_connection()
        with conn.cursor() as cursor:
            cursor.execute("SELECT * FROM simulations WHERE id = %s;", (job_id,))
            row = cursor.fetchone()
        conn.close()
        if row and row.get("results_json"):
            res = json.loads(row["results_json"])
            res["id"] = row["id"]
            res["status"] = row["status"]
            return res
        return None
    except Exception as e:
        logger.warning(f"Could not fetch simulation from TiDB: {e}")
        return None

def save_comparison(job_id: str, compare_data: Dict[str, Any]) -> bool:
    """Save multi-variant comparison result to TiDB Cloud."""
    try:
        status = compare_data.get("status", "complete")
        best_label = compare_data.get("best_variant_label", "")
        rec_text = compare_data.get("recommendation_text", "")
        variants_count = len(compare_data.get("results", []))

        conn = get_connection()
        with conn.cursor() as cursor:
            cursor.execute("""
            INSERT INTO comparisons (id, status, best_variant_label, recommendation_text, variants_count, comparison_data_json)
            VALUES (%s, %s, %s, %s, %s, %s)
            ON DUPLICATE KEY UPDATE
                status=VALUES(status),
                best_variant_label=VALUES(best_variant_label),
                recommendation_text=VALUES(recommendation_text),
                variants_count=VALUES(variants_count),
                comparison_data_json=VALUES(comparison_data_json);
            """, (
                job_id, status, best_label, rec_text, variants_count, json.dumps(compare_data)
            ))
        conn.close()
        return True
    except Exception as e:
        logger.warning(f"Could not persist comparison to TiDB: {e}")
        return False

def get_comparison_from_db(job_id: str) -> Optional[Dict[str, Any]]:
    """Retrieve comparison result from TiDB Cloud."""
    try:
        conn = get_connection()
        with conn.cursor() as cursor:
            cursor.execute("SELECT * FROM comparisons WHERE id = %s;", (job_id,))
            row = cursor.fetchone()
        conn.close()
        if row and row.get("comparison_data_json"):
            return json.loads(row["comparison_data_json"])
        return None
    except Exception as e:
        logger.warning(f"Could not fetch comparison from TiDB: {e}")
        return None

def get_history_from_db(limit: int = 20) -> List[Dict[str, Any]]:
    """Get list of recent simulation runs for history dashboard."""
    try:
        conn = get_connection()
        with conn.cursor() as cursor:
            cursor.execute("""
            SELECT id, variant_label, engine_used, status, min_inside_temp_C,
                   peak_inside_temp_C, max_temp_diff_C, efficiency_score,
                   total_solar_kwh, total_heat_loss_kwh, created_at
            FROM simulations
            ORDER BY created_at DESC
            LIMIT %s;
            """, (limit,))
            rows = cursor.fetchall()
        conn.close()
        # format timestamps
        for r in rows:
            if r.get("created_at"):
                r["created_at"] = str(r["created_at"])
        return rows
    except Exception as e:
        logger.warning(f"Could not fetch history from TiDB: {e}")
        return []

def get_db_status() -> Dict[str, Any]:
    """Check live status of TiDB Cloud MySQL database."""
    try:
        conn = get_connection()
        with conn.cursor() as cursor:
            cursor.execute("SELECT VERSION() AS ver;")
            ver = cursor.fetchone()
            cursor.execute("SELECT COUNT(*) AS total_sims FROM simulations;")
            sims = cursor.fetchone()
            cursor.execute("SELECT COUNT(*) AS total_comps FROM comparisons;")
            comps = cursor.fetchone()
            cursor.execute("SELECT COUNT(*) AS total_mats FROM materials_catalog;")
            mats = cursor.fetchone()
        conn.close()
        return {
            "connected": True,
            "engine": "TiDB Cloud Serverless (MySQL 8.0 Protocol)",
            "host": TIDB_CONFIG["host"],
            "database": TIDB_CONFIG["database"],
            "version": ver["ver"] if ver else "8.0",
            "total_simulations_recorded": sims["total_sims"] if sims else 0,
            "total_comparisons_recorded": comps["total_comps"] if comps else 0,
            "materials_count": mats["total_mats"] if mats else 0,
        }
    except Exception as e:
        return {
            "connected": False,
            "error": str(e),
            "engine": "TiDB Cloud MySQL (Offline/Fallback Mode)",
        }
