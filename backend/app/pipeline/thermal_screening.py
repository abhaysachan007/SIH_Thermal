"""
app.pipeline.thermal_screening
==============================
Physics-Based Fast Thermal Pre-Screening Engine.
Calculates component-wise conductive resistances, solar flux, infiltration,
and dynamic indoor temperature through a transient lumped thermal-capacitance formulation:
  C_eff * dT_inside/dt = Q_solar + Q_internal - Q_loss
"""
import math
from typing import Dict, Any, List
from app.pipeline.models import CandidateShelter, ThermalMetrics
from app.pipeline.material_repo import get_material_repo, MaterialRepository
from app.pipeline.climate_repo import ClimateTimeSeries

COMFORT_TEMP_MIN_C = 15.0  # ASHRAE / Himalayan cold-climate comfort threshold
COMFORT_TEMP_MAX_C = 25.0
AIR_DENSITY_HIGH_ALT = 0.85 # kg/m^3 at 3500m altitude
AIR_SPECIFIC_HEAT = 1005.0  # J/(kg*K)
GROUND_TEMP_C = 4.0         # Deep soil temperature in winter


class ThermalScreeningEngine:
    def __init__(self, material_repo: MaterialRepository = None):
        self.mat_repo = material_repo or get_material_repo()

    def evaluate(
        self,
        candidate: CandidateShelter,
        climate: ClimateTimeSeries,
        dt_seconds: float = 3600.0,
        warmup_cycles: int = 2
    ) -> ThermalMetrics:
        geom = candidate.geometry
        roof = candidate.roof
        wall = candidate.wall_system
        openings = candidate.openings

        # --- Geometry Areas ---
        L = geom.length_m
        W = geom.width_m
        H = geom.wall_height_m

        A_south_gross = L * H
        A_north_gross = L * H
        A_east_gross  = W * H
        A_west_gross  = W * H

        # Pitched roof gross area
        pitch_rad = math.radians(roof.angle_deg)
        A_roof_gross = (L * W) / max(0.2, math.cos(pitch_rad))
        A_floor_gross = L * W
        V_internal = L * W * H

        # --- Openings Breakdown ---
        A_win_by_wall = {"south": 0.0, "north": 0.0, "east": 0.0, "west": 0.0}
        win_u_area_sum = 0.0
        win_shgc_area_sum = 0.0
        A_door = 0.0
        door_u_area_sum = 0.0

        for op in openings:
            if op.type == "window":
                A_win_by_wall[op.wall] = A_win_by_wall.get(op.wall, 0.0) + op.area_m2
                u_win = self.mat_repo.calculate_opening_u_value(op.glass_material_id, "window")
                shgc_win = self.mat_repo.calculate_opening_shgc(op.glass_material_id)
                win_u_area_sum += u_win * op.area_m2
                win_shgc_area_sum += shgc_win * op.area_m2
            elif op.type == "door":
                A_door += op.area_m2
                u_door = self.mat_repo.calculate_opening_u_value(op.glass_material_id, "door")
                door_u_area_sum += u_door * op.area_m2

        # Net Opaque Areas
        A_south_opaque = max(0.5, A_south_gross - A_win_by_wall["south"] - (A_door if candidate.openings and candidate.openings[0].wall == "south" else 0.0))
        A_north_opaque = max(0.5, A_north_gross - A_win_by_wall["north"])
        A_east_opaque  = max(0.5, A_east_gross  - A_win_by_wall["east"])
        A_west_opaque  = max(0.5, A_west_gross  - A_win_by_wall["west"])
        A_total_walls_opaque = A_south_opaque + A_north_opaque + A_east_opaque + A_west_opaque

        # --- U-values & Thermal Resistances ---
        u_wall = self.mat_repo.calculate_wall_u_value(wall)
        u_roof = self.mat_repo.calculate_roof_u_value(roof)
        u_floor = self.mat_repo.calculate_floor_u_value(candidate.floor_material_id, candidate.floor_thickness_m)

        # Infiltration conductance: m_dot * cp = ACH * V * rho * cp / 3600 in W/K
        ach = 0.45  # Tight alpine envelope
        c_inf = (ach * V_internal * AIR_DENSITY_HIGH_ALT * AIR_SPECIFIC_HEAT) / 3600.0

        # --- Thermal Mass Capacitance (J/K) ---
        c_walls = self.mat_repo.calculate_wall_thermal_mass(wall, A_total_walls_opaque)
        # Roof mass
        r_mat = self.mat_repo.get(roof.material_id)
        c_roof = A_roof_gross * roof.thickness_m * r_mat.get("density", 1700.0) * r_mat.get("specific_heat", 879.0)
        # Floor mass (active top 10cm)
        f_mat = self.mat_repo.get(candidate.floor_material_id)
        c_floor = A_floor_gross * 0.10 * f_mat.get("density", 2000.0) * f_mat.get("specific_heat", 840.0)
        # Air mass
        c_air = V_internal * AIR_DENSITY_HIGH_ALT * AIR_SPECIFIC_HEAT

        # Total effective dynamic thermal capacitance (only ~40% of deep mass participates in daily cycle)
        C_eff = max(5e5, 0.40 * (c_walls + c_roof + c_floor) + c_air)

        # Internal Heat Gain (occupancy + basic lighting)
        q_internal_W = float(candidate.target_occupancy) * 75.0 + 50.0

        # --- Transient Integration Loop with Warm-Up Cycles ---
        # Initial indoor temperature = initial ambient
        t_inside = climate.records[0]["ambient_temperature_c"]
        total_steps = int((24 * 3600.0) / dt_seconds)

        # Warm-up cycles to eliminate cold-start transient
        for _ in range(warmup_cycles):
            for step in range(total_steps):
                t_sec = step * dt_seconds
                clim = climate.at_time(t_sec)
                t_amb = clim["ambient_temperature_c"]
                i_solar = clim["solar_irradiance_w_m2"]
                h_float = (t_sec / 3600.0) % 24.0

                # Solar aperture on south window
                f_south = climate.surface_solar_factor(candidate.orientation_deg, 90.0, h_float)
                q_solar_win = win_shgc_area_sum * i_solar * f_south

                # Heat losses
                q_loss_walls = u_wall * A_total_walls_opaque * (t_inside - t_amb)
                q_loss_roof  = u_roof * A_roof_gross * (t_inside - t_amb)
                q_loss_floor = u_floor * A_floor_gross * (t_inside - GROUND_TEMP_C)
                q_loss_win   = win_u_area_sum * (t_inside - t_amb)
                q_loss_door  = door_u_area_sum * (t_inside - t_amb)
                q_loss_inf   = c_inf * (t_inside - t_amb)

                q_total_loss = q_loss_walls + q_loss_roof + q_loss_floor + q_loss_win + q_loss_door + q_loss_inf
                q_net = (q_solar_win + q_internal_W) - q_total_loss

                t_inside += (q_net * dt_seconds) / C_eff

        # --- Final Evaluated 24-Hour Period ---
        hourly_indoor_temps = []
        hourly_ambient_temps = []
        hourly_solar_gains = []
        hourly_heat_losses = []

        total_wall_loss_J = 0.0
        total_roof_loss_J = 0.0
        total_floor_loss_J = 0.0
        total_win_loss_J = 0.0
        total_door_loss_J = 0.0
        total_inf_loss_J = 0.0
        total_solar_gain_J = 0.0
        aux_heating_energy_J = 0.0

        for step in range(total_steps):
            t_sec = step * dt_seconds
            clim = climate.at_time(t_sec)
            t_amb = clim["ambient_temperature_c"]
            i_solar = clim["solar_irradiance_w_m2"]
            h_float = (t_sec / 3600.0) % 24.0

            f_south = climate.surface_solar_factor(candidate.orientation_deg, 90.0, h_float)
            q_solar_win = win_shgc_area_sum * i_solar * f_south

            q_loss_walls = max(0.0, u_wall * A_total_walls_opaque * (t_inside - t_amb))
            q_loss_roof  = max(0.0, u_roof * A_roof_gross * (t_inside - t_amb))
            q_loss_floor = max(0.0, u_floor * A_floor_gross * (t_inside - GROUND_TEMP_C))
            q_loss_win   = max(0.0, win_u_area_sum * (t_inside - t_amb))
            q_loss_door  = max(0.0, door_u_area_sum * (t_inside - t_amb))
            q_loss_inf   = max(0.0, c_inf * (t_inside - t_amb))

            q_total_loss = q_loss_walls + q_loss_roof + q_loss_floor + q_loss_win + q_loss_door + q_loss_inf
            q_net = (q_solar_win + q_internal_W) - q_total_loss

            t_inside += (q_net * dt_seconds) / C_eff

            # Auxiliary heating energy required to maintain 18.0°C baseline
            if t_inside < 18.0:
                deficit_W = max(0.0, q_total_loss - (q_solar_win + q_internal_W))
                aux_heating_energy_J += deficit_W * dt_seconds

            # Accumulate energy totals (Joules)
            total_wall_loss_J += q_loss_walls * dt_seconds
            total_roof_loss_J += q_loss_roof * dt_seconds
            total_floor_loss_J += q_loss_floor * dt_seconds
            total_win_loss_J += q_loss_win * dt_seconds
            total_door_loss_J += q_loss_door * dt_seconds
            total_inf_loss_J += q_loss_inf * dt_seconds
            total_solar_gain_J += q_solar_win * dt_seconds

            hourly_indoor_temps.append(round(t_inside, 2))
            hourly_ambient_temps.append(round(t_amb, 2))
            hourly_solar_gains.append(round(q_solar_win, 1))
            hourly_heat_losses.append(round(q_total_loss, 1))

        # Convert Joules to kWh (1 kWh = 3.6e6 J)
        J_TO_KWH = 1.0 / 3.6e6

        min_t = min(hourly_indoor_temps)
        max_t = max(hourly_indoor_temps)
        avg_t = sum(hourly_indoor_temps) / len(hourly_indoor_temps)

        # Comfort hours within [15°C, 25°C]
        comfort_hrs = sum(1 for t in hourly_indoor_temps if COMFORT_TEMP_MIN_C <= t <= COMFORT_TEMP_MAX_C)
        comfort_pct = round((comfort_hrs / len(hourly_indoor_temps)) * 100.0, 1)

        tot_loss_kwh = (total_wall_loss_J + total_roof_loss_J + total_floor_loss_J + total_win_loss_J + total_door_loss_J + total_inf_loss_J) * J_TO_KWH

        return ThermalMetrics(
            min_indoor_temperature_c=round(min_t, 2),
            max_indoor_temperature_c=round(max_t, 2),
            average_indoor_temperature_c=round(avg_t, 2),
            comfort_hours=float(comfort_hrs),
            comfort_percentage=comfort_pct,
            wall_conductive_loss_kwh=round(total_wall_loss_J * J_TO_KWH, 3),
            roof_conductive_loss_kwh=round(total_roof_loss_J * J_TO_KWH, 3),
            floor_conductive_loss_kwh=round(total_floor_loss_J * J_TO_KWH, 3),
            window_conductive_loss_kwh=round(total_win_loss_J * J_TO_KWH, 3),
            door_conductive_loss_kwh=round(total_door_loss_J * J_TO_KWH, 3),
            infiltration_loss_kwh=round(total_inf_loss_J * J_TO_KWH, 3),
            total_heat_loss_kwh=round(tot_loss_kwh, 3),
            solar_gain_kwh=round(total_solar_gain_J * J_TO_KWH, 3),
            estimated_energy_requirement_kwh=round(aux_heating_energy_J * J_TO_KWH, 3),
            hourly_indoor_temps=hourly_indoor_temps,
            hourly_ambient_temps=hourly_ambient_temps,
            hourly_solar_gains=hourly_solar_gains,
            hourly_heat_losses=hourly_heat_losses,
        )
