import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';

export default function Shelter3DViewer({
  shelterData,
  ansysData,
  height = '460px',
}) {
  const mountRef = useRef(null);
  const [wireframe, setWireframe] = useState(false);
  const [showRoof, setShowRoof] = useState(true);
  const [showSun, setShowSun] = useState(true);
  const [thermalMode, setThermalMode] = useState(true);
  const [roofType, setRoofType] = useState('pitched');

  // Extract dimensions
  const shape = shelterData?.shape || 'rectangular';
  const length = parseFloat(shelterData?.length_m || 6.0);
  const width = parseFloat(shelterData?.width_m || 4.0);
  const height_m = parseFloat(shelterData?.height_m || 3.0);
  const wallThk = parseFloat(shelterData?.wall_thickness_m || 0.45);
  const orientationDeg = parseFloat(shelterData?.orientation_deg ?? shelterData?.orientation ?? 180);

  // Interactive Sun Azimuth State (allows user to scrub sun position directly on the 3D HUD)
  const [sunAngle, setSunAngle] = useState(orientationDeg);
  useEffect(() => {
    setSunAngle(orientationDeg);
  }, [orientationDeg]);

  // Thermal temperatures extracted from simulation result
  const maxInsideTemp = parseFloat(ansysData?.peak_inside_temp_C || ansysData?.result?.peak_inside_temp_C || 24.2);
  const minInsideTemp = parseFloat(ansysData?.min_inside_temp_C || ansysData?.result?.min_inside_temp_C || 3.1);
  const avgTemp = parseFloat(ansysData?.avg_inside_temp_C || ansysData?.result?.avg_inside_temp_C || 14.5);

  // Surface temperatures from ANSYS FEA (if available)
  const surfTemps = ansysData?.surface_temperatures || ansysData?.result?.surface_temperatures || null;
  const surfTempValuesTop = surfTemps
    ? Object.values(surfTemps).filter((v) => v != null)
    : [];
  // Same range the 3D model's thermal colors are normalized against, so the
  // scale bar's printed min/max always matches what the colors represent.
  const scaleMaxTemp = surfTempValuesTop.length ? Math.max(...surfTempValuesTop) + 2 : maxInsideTemp + 5;
  const scaleMinTemp = surfTempValuesTop.length ? Math.min(...surfTempValuesTop) - 2 : minInsideTemp - 5;

  // Parse and expand all openings dynamically
  const rawOpenings = shelterData?.openings || [];
  let totalWindows = 0;
  let totalDoors = 0;

  rawOpenings.forEach((op) => {
    const count = parseInt(op.count || 1);
    if (op.type === 'window') totalWindows += count;
    else if (op.type === 'door') totalDoors += count;
  });

  if (totalWindows === 0 && totalDoors === 0) {
    totalWindows = 3;
    totalDoors = 1;
  }

  // Multi-wall rule allocation
  const allocateWallOpenings = (totalD, totalW) => {
    let remD = totalD;
    let remW = totalW;
    const walls = ['south', 'east', 'west', 'north'];
    const wallAssignments = {};

    walls.forEach((wallKey) => {
      let d = 0;
      if (remD > 0) {
        d = Math.min(remD, 2);
        remD -= d;
      }
      let maxW = 4;
      if (d === 1) maxW = 3;
      else if (d >= 2) maxW = 2;

      let w = 0;
      if (remW > 0) {
        w = Math.min(remW, maxW);
        remW -= w;
      }
      wallAssignments[wallKey] = { doors: d, windows: w };
    });

    if (remW > 0) wallAssignments.north.windows += remW;
    if (remD > 0) wallAssignments.north.doors += remD;
    return wallAssignments;
  };

  const wallLayouts = allocateWallOpenings(totalDoors, totalWindows);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    // --- Scene & Camera ---
    const scene = new THREE.Scene();
    // In thermal mode, use dark thermographic FLIR background
    scene.background = new THREE.Color(thermalMode ? 0x050b14 : 0xf8fafc);

    const aspect = container.clientWidth / container.clientHeight;
    // Far plane must scale with building size to prevent clipping on large buildings
    const maxDim = Math.max(length, width, height_m);
    const farPlane = Math.max(500, maxDim * 20);
    const camera = new THREE.PerspectiveCamera(45, aspect, 0.1, farPlane);
    
    // Position camera at front isometric angle, scaled to building
    camera.position.set(maxDim * 1.6, maxDim * 1.3, maxDim * 2.2);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    while (container.firstChild) container.removeChild(container.firstChild);
    container.appendChild(renderer.domElement);

    // --- Dynamic Solar Lighting & Sun Position ---
    const activeAzimuth = sunAngle ?? orientationDeg ?? 180;
    const sunRad = (activeAzimuth - 90) * (Math.PI / 180);
    const sunDist = Math.max(length, width, height_m) * 2.2;
    const sunX = Math.cos(sunRad) * sunDist;
    const sunZ = Math.sin(sunRad) * sunDist;
    const sunY = Math.max(height_m * 1.6, sunDist * 0.7);

    const ambientLight = new THREE.AmbientLight(0xffffff, thermalMode ? 0.75 : 0.85);
    scene.add(ambientLight);

    // Directional Sun Light placed EXACTLY at the Sun coordinates pointing directly at the shelter
    const dirLight = new THREE.DirectionalLight(0xfff5db, thermalMode ? 1.1 : 1.4);
    dirLight.position.set(sunX, sunY, sunZ);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 2048;
    dirLight.shadow.mapSize.height = 2048;
    dirLight.shadow.camera.near = 0.5;
    dirLight.shadow.camera.far = sunDist * 3.5;
    const d = Math.max(length, width, height_m) * 1.5;
    dirLight.shadow.camera.left = -d;
    dirLight.shadow.camera.right = d;
    dirLight.shadow.camera.top = d;
    dirLight.shadow.camera.bottom = -d;
    scene.add(dirLight);

    // Subtle sky ambient fill from opposite side
    const fillLight = new THREE.DirectionalLight(0xbcd7ff, 0.35);
    fillLight.position.set(-sunX * 0.5, sunY * 0.5, -sunZ * 0.5);
    scene.add(fillLight);

    // --- Ground Grid ---
    const gridColor1 = thermalMode ? 0x1e293b : 0x94a3b8;
    const gridColor2 = thermalMode ? 0x0f172a : 0xe2e8f0;
    const gridHelper = new THREE.GridHelper(Math.max(length, width) * 2.5, 20, gridColor1, gridColor2);
    gridHelper.position.y = -0.01;
    scene.add(gridHelper);

    // --- Material Colors & Dynamic Solar Exposure Gradient ---
    // Normalized Sun vector in XZ plane
    const sunDirNorm = new THREE.Vector3(sunX, 0, sunZ).normalize();

    // Solar dot product on 4 primary facades:
    // South (+Z), North (-Z), East (+X), West (-X)
    const dotSouth = Math.max(0, sunDirNorm.dot(new THREE.Vector3(0, 0, 1)));
    const dotNorth = Math.max(0, sunDirNorm.dot(new THREE.Vector3(0, 0, -1)));
    const dotEast  = Math.max(0, sunDirNorm.dot(new THREE.Vector3(1, 0, 0)));
    const dotWest  = Math.max(0, sunDirNorm.dot(new THREE.Vector3(-1, 0, 0)));

    // Material definition helper for Realistic Mode
    const wallMatId = shelterData?.wall_material_id || 'mud_brick';
    let baseArchWallColor = 0xc29b74; // Mud Brick default
    if (wallMatId.includes('stone') || wallMatId.includes('granite')) baseArchWallColor = 0x948b7d;
    else if (wallMatId.includes('rammed')) baseArchWallColor = 0x9c7a59;
    else if (wallMatId.includes('composite') || wallMatId.includes('eps')) baseArchWallColor = 0xded5c7;
    else if (wallMatId.includes('concrete')) baseArchWallColor = 0x8a8f96;

    // FLIR thermal color mapping: maps temperature to infrared spectrum
    // Uses real ANSYS surface temperatures when available, falls back to solar exposure
    const surfTemps = ansysData?.surface_temperatures || ansysData?.result?.surface_temperatures || null;
    // Normalize against the same surface-temperature range the scale bar
    // legend prints (scaleMinTemp/scaleMaxTemp, computed above from
    // surfTemps) — using the narrower interior min/max here clipped hot
    // surfaces to saturated red and pushed very cold surfaces into the
    // "moderate" green band instead of blue, misrepresenting real ANSYS data.
    const getThermalColorFromTemp = (tempC) => {
      // Map temperature range to FLIR color spectrum
      const norm = Math.max(0, Math.min(1, (tempC - scaleMinTemp) / Math.max(1, scaleMaxTemp - scaleMinTemp)));
      if (norm > 0.85) return 0xef4444; // Hot Red
      if (norm > 0.65) return 0xf59e0b; // Warm Amber
      if (norm > 0.45) return 0xeab308; // Yellow
      if (norm > 0.25) return 0x84cc16; // Moderate Green
      if (norm > 0.10) return 0x06b6d4; // Cool Cyan
      return 0x1d4ed8; // Cold Blue
    };

    const getThermalColor = (solarExp, surfaceTempC) => {
      if (surfaceTempC != null) return getThermalColorFromTemp(surfaceTempC);
      if (solarExp > 0.65) return 0xf59e0b;
      if (solarExp > 0.30) return 0x84cc16;
      return 0x06b6d4;
    };

    const southWallColor = thermalMode ? getThermalColor(dotSouth, surfTemps?.south_wall_inner_C) : baseArchWallColor;
    const northWallColor = thermalMode ? getThermalColor(dotNorth, surfTemps?.north_wall_inner_C) : baseArchWallColor;
    const eastWallColor  = thermalMode ? getThermalColor(dotEast, surfTemps?.east_wall_inner_C)  : baseArchWallColor;
    const westWallColor  = thermalMode ? getThermalColor(dotWest, surfTemps?.west_wall_inner_C)  : baseArchWallColor;

    const roofColor   = thermalMode ? getThermalColor(dotSouth > 0.3 ? 0.7 : 0.2, surfTemps?.roof_inner_C) : 0x8b4513;
    const plinthColor = thermalMode ? 0x1d4ed8 : 0x475569;
    const glassColor  = thermalMode ? (dotSouth > 0.4 ? 0xef4444 : 0x38bdf8) : 0x60a5fa;
    const doorColor   = thermalMode ? 0xd97706 : 0x5c3a21;

    const sWallMat = new THREE.MeshStandardMaterial({ color: southWallColor, roughness: 0.85, wireframe });
    const nWallMat = new THREE.MeshStandardMaterial({ color: northWallColor, roughness: 0.85, wireframe });
    const eWallMat = new THREE.MeshStandardMaterial({ color: eastWallColor, roughness: 0.85, wireframe });
    const wWallMat = new THREE.MeshStandardMaterial({ color: westWallColor, roughness: 0.85, wireframe });
    const roofMat  = new THREE.MeshStandardMaterial({ color: roofColor, roughness: 0.65, wireframe });
    const plinthMat = new THREE.MeshStandardMaterial({ color: plinthColor, roughness: 0.9, wireframe });
    const floorMat = new THREE.MeshStandardMaterial({ color: thermalMode ? 0x10b981 : 0x6e5238, roughness: 0.9, wireframe });

    const glassMat = new THREE.MeshPhysicalMaterial({
      color: glassColor,
      transparent: true,
      opacity: thermalMode ? 0.92 : 0.65,
      roughness: 0.1,
      metalness: 0.1,
      transmission: thermalMode ? 0 : 0.6,
      emissive: thermalMode ? (dotSouth > 0.4 ? 0x991b1b : 0x075985) : 0x000000,
      emissiveIntensity: thermalMode ? 0.65 : 0,
      wireframe,
    });

    const doorMat = new THREE.MeshStandardMaterial({ color: doorColor, roughness: 0.6, wireframe });
    const frameMat = new THREE.MeshStandardMaterial({ color: thermalMode ? 0x78350f : 0x334155, roughness: 0.4, wireframe });

    // --- Shelter Group ---
    const shelterGroup = new THREE.Group();
    const cx = length / 2;
    const cz = width / 2;

    // --- 1. Stone Foundation Plinth ---
    const plinthGeo = new THREE.BoxGeometry(length + wallThk * 2 + 0.4, 0.3, width + wallThk * 2 + 0.4);
    const plinthMesh = new THREE.Mesh(plinthGeo, plinthMat);
    plinthMesh.position.set(0, -0.15, 0);
    plinthMesh.receiveShadow = true;
    shelterGroup.add(plinthMesh);

    // --- 2. Interior Floor Slab ---
    const floorGeo = new THREE.BoxGeometry(length, 0.1, width);
    const floorMesh = new THREE.Mesh(floorGeo, floorMat);
    floorMesh.position.set(0, 0.05, 0);
    floorMesh.receiveShadow = true;
    shelterGroup.add(floorMesh);

    // --- 3. Wall Builder Function ---
    const buildWall = (wallKey, wallSpan, doorsCount, winsCount, specificWallMat) => {
      const isZAxis = wallKey === 'south' || wallKey === 'north';
      const wallGroup = new THREE.Group();

      if (doorsCount === 0 && winsCount === 0) {
        const sGeo = isZAxis
          ? new THREE.BoxGeometry(wallSpan + wallThk * 2, height_m, wallThk)
          : new THREE.BoxGeometry(wallThk, height_m, wallSpan);
        const sMesh = new THREE.Mesh(sGeo, specificWallMat);
        sMesh.position.y = height_m / 2;
        sMesh.castShadow = true;
        sMesh.receiveShadow = true;
        wallGroup.add(sMesh);
        return wallGroup;
      }

      const totalItems = doorsCount + winsCount;
      const margin = 0.4;
      const usableSpan = wallSpan - margin * 2;
      const doorW = Math.min(0.9, usableSpan / Math.max(1, totalItems * 1.3));
      const doorH = Math.min(2.1, height_m * 0.85);

      const winW = Math.min(1.2, (usableSpan - doorsCount * doorW) / Math.max(1, winsCount * 1.3));
      const winH = Math.min(1.2, height_m * 0.55);
      const winSill = Math.max(0.65, (height_m - winH) * 0.45);
      const winTop = winSill + winH;

      const items = [];
      let curT = -wallSpan / 2 + margin;

      for (let i = 0; i < doorsCount; i++) {
        items.push({
          type: 'door',
          t1: curT,
          t2: curT + doorW,
          tc: curT + doorW / 2,
          w: doorW,
          h: doorH,
          sill: 0,
          top: doorH,
        });
        curT += doorW + 0.35;
      }

      const winGap = winsCount > 0 ? Math.max(0.2, (wallSpan / 2 - margin - curT - winsCount * winW) / winsCount) : 0;
      for (let j = 0; j < winsCount; j++) {
        items.push({
          type: 'window',
          t1: curT,
          t2: curT + winW,
          tc: curT + winW / 2,
          w: winW,
          h: winH,
          sill: winSill,
          top: winTop,
        });
        curT += winW + winGap;
      }

      let cursor = -wallSpan / 2 - (isZAxis ? wallThk : 0);
      const maxOpeningTop = Math.max(doorH, winTop);

      items.forEach((item) => {
        const pillarW = item.t1 - cursor;
        if (pillarW > 0.04) {
          const pGeo = isZAxis
            ? new THREE.BoxGeometry(pillarW, height_m, wallThk)
            : new THREE.BoxGeometry(wallThk, height_m, pillarW);
          const pMesh = new THREE.Mesh(pGeo, specificWallMat);
          const pPos = cursor + pillarW / 2;
          if (isZAxis) pMesh.position.set(pPos, height_m / 2, 0);
          else pMesh.position.set(0, height_m / 2, pPos);
          pMesh.castShadow = true;
          pMesh.receiveShadow = true;
          wallGroup.add(pMesh);
        }

        if (item.type === 'window') {
          // Sill Wall
          const sillGeo = isZAxis
            ? new THREE.BoxGeometry(item.w, item.sill, wallThk)
            : new THREE.BoxGeometry(wallThk, item.sill, item.w);
          const sillMesh = new THREE.Mesh(sillGeo, specificWallMat);
          if (isZAxis) sillMesh.position.set(item.tc, item.sill / 2, 0);
          else sillMesh.position.set(0, item.sill / 2, item.tc);
          wallGroup.add(sillMesh);

          // Glass Pane
          const gGeo = isZAxis
            ? new THREE.BoxGeometry(item.w - 0.05, item.h - 0.05, 0.04)
            : new THREE.BoxGeometry(0.04, item.h - 0.05, item.w - 0.05);
          const gMesh = new THREE.Mesh(gGeo, glassMat);
          if (isZAxis) gMesh.position.set(item.tc, item.sill + item.h / 2, 0);
          else gMesh.position.set(0, item.sill + item.h / 2, item.tc);
          wallGroup.add(gMesh);

          // Mullions
          const fHGeo = isZAxis
            ? new THREE.BoxGeometry(item.w, 0.035, 0.06)
            : new THREE.BoxGeometry(0.06, 0.035, item.w);
          const fH = new THREE.Mesh(fHGeo, frameMat);
          if (isZAxis) fH.position.set(item.tc, item.sill + item.h / 2, 0);
          else fH.position.set(0, item.sill + item.h / 2, item.tc);
          wallGroup.add(fH);

          const fVGeo = isZAxis
            ? new THREE.BoxGeometry(0.035, item.h, 0.06)
            : new THREE.BoxGeometry(0.06, item.h, 0.035);
          const fV = new THREE.Mesh(fVGeo, frameMat);
          if (isZAxis) fV.position.set(item.tc, item.sill + item.h / 2, 0);
          else fV.position.set(0, item.sill + item.h / 2, item.tc);
          wallGroup.add(fV);
        }

        if (item.type === 'door') {
          const dGeo = isZAxis
            ? new THREE.BoxGeometry(item.w - 0.05, item.h - 0.04, 0.06)
            : new THREE.BoxGeometry(0.06, item.h - 0.04, item.w - 0.05);
          const dMesh = new THREE.Mesh(dGeo, doorMat);
          if (isZAxis) dMesh.position.set(item.tc, item.h / 2, 0);
          else dMesh.position.set(0, item.h / 2, item.tc);
          wallGroup.add(dMesh);

          const hGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.12);
          const hMat = new THREE.MeshStandardMaterial({ color: 0xd97706, metalness: 0.8 });
          const hMesh = new THREE.Mesh(hGeo, hMat);
          hMesh.rotation.z = Math.PI / 2;
          if (isZAxis) hMesh.position.set(item.tc + item.w * 0.35, 1.0, 0.05);
          else hMesh.position.set(0.05, 1.0, item.tc + item.w * 0.35);
          wallGroup.add(hMesh);
        }

        cursor = item.t2;
      });

      const endLimit = wallSpan / 2 + (isZAxis ? wallThk : 0);
      const endPillarW = endLimit - cursor;
      if (endPillarW > 0.04) {
        const epGeo = isZAxis
          ? new THREE.BoxGeometry(endPillarW, height_m, wallThk)
          : new THREE.BoxGeometry(wallThk, height_m, endPillarW);
        const epMesh = new THREE.Mesh(epGeo, specificWallMat);
        const epPos = cursor + endPillarW / 2;
        if (isZAxis) epMesh.position.set(epPos, height_m / 2, 0);
        else epMesh.position.set(0, height_m / 2, epPos);
        wallGroup.add(epMesh);
      }

      const lintelH = height_m - maxOpeningTop;
      if (lintelH > 0.05) {
        const lGeo = isZAxis
          ? new THREE.BoxGeometry(wallSpan + wallThk * 2, lintelH, wallThk)
          : new THREE.BoxGeometry(wallThk, lintelH, wallSpan);
        const lMesh = new THREE.Mesh(lGeo, specificWallMat);
        if (isZAxis) lMesh.position.set(0, height_m - lintelH / 2, 0);
        else lMesh.position.set(0, height_m - lintelH / 2, 0);
        wallGroup.add(lMesh);
      }

      return wallGroup;
    };

    // --- Shape-Conditional: Igloo Dome vs Rectangular House ---
    if (shape === 'dome') {
      const R = Math.max(length, width) / 2 + 0.3; // outer radius
      const domeH = height_m;

      // --- Igloo Main Dome Shell (pure hemisphere, sky-blue/white gradient look) ---
      // Outer shell — light sky blue / ice white
      const iglooMat = new THREE.MeshPhysicalMaterial({
        color: thermalMode ? 0x7dd3fc : 0xe0f2fe,  // sky-blue in arch mode, FLIR cold-cyan in thermal
        roughness: 0.15,
        metalness: 0.05,
        clearcoat: 0.6,
        clearcoatRoughness: 0.1,
        transparent: true,
        opacity: 0.96,
        wireframe,
      });

      // Main dome hemisphere
      const domeGeo = new THREE.SphereGeometry(R, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2);
      const domeMesh = new THREE.Mesh(domeGeo, iglooMat);
      domeMesh.scale.y = domeH / R; // flatten/stretch to match user height
      domeMesh.position.set(0, 0, 0);
      domeMesh.castShadow = true;
      domeMesh.receiveShadow = true;
      shelterGroup.add(domeMesh);

      // --- Snow Block Stacking Rings (igloo characteristic horizontal bands) ---
      const ringMat = new THREE.MeshStandardMaterial({
        color: thermalMode ? 0x38bdf8 : 0xbae6fd,
        roughness: 0.3,
        wireframe,
      });
      const numRings = 5;
      for (let r = 0; r < numRings; r++) {
        const ringAngle = (r / numRings) * (Math.PI / 2); // from base to apex
        const ringY = Math.sin(ringAngle) * domeH;
        const ringR = Math.cos(ringAngle) * R;
        if (ringR < 0.3) continue;
        const ringGeo = new THREE.TorusGeometry(ringR, 0.045, 8, 48);
        const ringMesh = new THREE.Mesh(ringGeo, ringMat);
        ringMesh.position.set(0, ringY, 0);
        ringMesh.rotation.x = Math.PI / 2;
        shelterGroup.add(ringMesh);
      }

      // --- Thin Snow Block Vertical Seam Lines on dome surface ---
      const seamMat = new THREE.MeshStandardMaterial({ color: thermalMode ? 0x0ea5e9 : 0x93c5fd, roughness: 0.5, wireframe });
      const numSeams = 8;
      for (let s = 0; s < numSeams; s++) {
        const angle = (s / numSeams) * Math.PI * 2;
        const points = [];
        for (let t = 0; t <= 20; t++) {
          const phi = (t / 20) * (Math.PI / 2);
          const x = Math.cos(angle) * Math.cos(phi) * R * 0.99;
          const z = Math.sin(angle) * Math.cos(phi) * R * 0.99;
          const y = Math.sin(phi) * domeH * 0.99;
          points.push(new THREE.Vector3(x, y, z));
        }
        const curve = new THREE.CatmullRomCurve3(points);
        const seamGeo = new THREE.TubeGeometry(curve, 20, 0.025, 4, false);
        const seamMesh = new THREE.Mesh(seamGeo, seamMat);
        shelterGroup.add(seamMesh);
      }

      // --- Flat circular base / ice floor disc ---
      const baseGeo = new THREE.CylinderGeometry(R + 0.15, R + 0.25, 0.12, 48);
      const baseMat = new THREE.MeshStandardMaterial({
        color: thermalMode ? 0x0284c7 : 0xdbeafe,
        roughness: 0.6,
        wireframe,
      });
      const baseMesh = new THREE.Mesh(baseGeo, baseMat);
      baseMesh.position.set(0, 0.06, 0);
      baseMesh.receiveShadow = true;
      shelterGroup.add(baseMesh);

      // --- Arched Entry Tunnel (low igloo entrance on south face) ---
      const tunnelLength = Math.min(1.8, R * 0.5);
      const tunnelW = 0.9;
      const tunnelH = 1.1;
      const entryMat = new THREE.MeshPhysicalMaterial({
        color: thermalMode ? 0x7dd3fc : 0xdbeafe,
        roughness: 0.2,
        transparent: true,
        opacity: 0.9,
        clearcoat: 0.5,
        wireframe,
      });

      // Tunnel arch (half-cylinder)
      const tunnelGeo = new THREE.CylinderGeometry(tunnelW / 2, tunnelW / 2, tunnelLength, 24, 1, true, 0, Math.PI);
      const tunnelMesh = new THREE.Mesh(tunnelGeo, entryMat);
      tunnelMesh.rotation.z = Math.PI / 2;  // lay the cylinder horizontal
      tunnelMesh.rotation.y = Math.PI / 2;
      tunnelMesh.position.set(0, tunnelH / 2, R + tunnelLength / 2);
      shelterGroup.add(tunnelMesh);

      // Tunnel floor
      const tFloorGeo = new THREE.BoxGeometry(tunnelW, 0.08, tunnelLength);
      const tFloorMesh = new THREE.Mesh(tFloorGeo, baseMat);
      tFloorMesh.position.set(0, 0.04, R + tunnelLength / 2);
      shelterGroup.add(tFloorMesh);

      // Tunnel opening cutout (dark arch indicating interior)
      const tunnelOpenGeo = new THREE.CylinderGeometry(tunnelW / 2 - 0.05, tunnelW / 2 - 0.05, 0.15, 24, 1, true, 0, Math.PI);
      const tunnelOpenMat = new THREE.MeshBasicMaterial({ color: 0x0c1a2e, side: THREE.BackSide });
      const tunnelOpenMesh = new THREE.Mesh(tunnelOpenGeo, tunnelOpenMat);
      tunnelOpenMesh.rotation.z = Math.PI / 2;
      tunnelOpenMesh.rotation.y = Math.PI / 2;
      tunnelOpenMesh.position.set(0, tunnelH / 2, R + tunnelLength + 0.05);
      shelterGroup.add(tunnelOpenMesh);

      // --- Glowing Ice-Blue Skylight Oculus at Apex ---
      const oclGeo = new THREE.CircleGeometry(R * 0.1, 32);
      const oclMat = new THREE.MeshPhysicalMaterial({
        color: 0x7ef4fc,
        emissive: thermalMode ? 0x00e5ff : 0x38bdf8,
        emissiveIntensity: thermalMode ? 1.0 : 0.5,
        transparent: true,
        opacity: 0.85,
        roughness: 0.05,
        clearcoat: 1.0,
      });
      const oclMesh = new THREE.Mesh(oclGeo, oclMat);
      oclMesh.rotation.x = -Math.PI / 2;
      oclMesh.position.set(0, domeH * 0.995, 0);
      shelterGroup.add(oclMesh);

      // Glowing point light inside dome to simulate warm inner air
      const iglooLight = new THREE.PointLight(0x7ef4fc, thermalMode ? 1.5 : 0.6, R * 3);
      iglooLight.position.set(0, domeH * 0.4, 0);
      scene.add(iglooLight);

    } else {
      // Rectangular house walls
      const sWall = buildWall('south', length, wallLayouts.south.doors, wallLayouts.south.windows, sWallMat);
      sWall.position.set(0, 0, cz + wallThk / 2);
      shelterGroup.add(sWall);

      const nWall = buildWall('north', length, wallLayouts.north.doors, wallLayouts.north.windows, nWallMat);
      nWall.position.set(0, 0, -cz - wallThk / 2);
      shelterGroup.add(nWall);

      const eWall = buildWall('east', width, wallLayouts.east.doors, wallLayouts.east.windows, eWallMat);
      eWall.position.set(cx + wallThk / 2, 0, 0);
      shelterGroup.add(eWall);

      const wWall = buildWall('west', width, wallLayouts.west.doors, wallLayouts.west.windows, wWallMat);
      wWall.position.set(-cx - wallThk / 2, 0, 0);
      shelterGroup.add(wWall);
    }

    // --- 4. Realistic Pitched / Gable Roof vs Flat Roof (rectangular only) ---
    if (showRoof && shape !== 'dome') {
      if (roofType === 'pitched') {
        const pitchHeight = 1.6;
        const totalW = width + wallThk * 2 + 0.8;
        const totalL = length + wallThk * 2 + 0.8;
        const slopeLen = Math.sqrt(Math.pow(totalW / 2, 2) + Math.pow(pitchHeight, 2));
        const slopeAngle = Math.atan2(pitchHeight, totalW / 2);

        // South Roof Slope (Facing Front)
        const sSlopeGeo = new THREE.BoxGeometry(totalL, 0.12, slopeLen);
        const sSlopeMesh = new THREE.Mesh(sSlopeGeo, roofMat);
        sSlopeMesh.position.set(0, height_m + pitchHeight / 2, totalW / 4);
        sSlopeMesh.rotation.x = slopeAngle;
        sSlopeMesh.castShadow = true;
        shelterGroup.add(sSlopeMesh);

        // North Roof Slope (Facing Back)
        const nSlopeGeo = new THREE.BoxGeometry(totalL, 0.12, slopeLen);
        const nSlopeMesh = new THREE.Mesh(nSlopeGeo, roofMat);
        nSlopeMesh.position.set(0, height_m + pitchHeight / 2, -totalW / 4);
        nSlopeMesh.rotation.x = -slopeAngle;
        nSlopeMesh.castShadow = true;
        shelterGroup.add(nSlopeMesh);

        // Roof Ridge Cap (Apex)
        const ridgeGeo = new THREE.BoxGeometry(totalL + 0.1, 0.15, 0.2);
        const ridgeMat = new THREE.MeshStandardMaterial({ color: thermalMode ? 0xf97316 : 0x5c3d1e, roughness: 0.5 });
        const ridgeMesh = new THREE.Mesh(ridgeGeo, ridgeMat);
        ridgeMesh.position.set(0, height_m + pitchHeight + 0.05, 0);
        shelterGroup.add(ridgeMesh);

        // East & West Triangular Gable End Walls
        const createGableTriangle = (mat) => {
          const shape = new THREE.Shape();
          shape.moveTo(-width / 2 - wallThk, 0);
          shape.lineTo(width / 2 + wallThk, 0);
          shape.lineTo(0, pitchHeight);
          shape.closePath();
          const geom = new THREE.ExtrudeGeometry(shape, { depth: wallThk, bevelEnabled: false });
          return new THREE.Mesh(geom, mat);
        };

        const eGable = createGableTriangle(eWallMat);
        eGable.rotation.y = Math.PI / 2;
        eGable.position.set(cx + wallThk, height_m, 0);
        shelterGroup.add(eGable);

        const wGable = createGableTriangle(wWallMat);
        wGable.rotation.y = Math.PI / 2;
        wGable.position.set(-cx, height_m, 0);
        shelterGroup.add(wGable);

        // Chimney / Flue Vent (Classic Alpine House Feature)
        const chimGeo = new THREE.BoxGeometry(0.5, 1.2, 0.5);
        const chimMat = new THREE.MeshStandardMaterial({ color: thermalMode ? 0xef4444 : 0x78350f });
        const chimMesh = new THREE.Mesh(chimGeo, chimMat);
        chimMesh.position.set(-cx + 1.2, height_m + pitchHeight * 0.8, -cz * 0.3);
        shelterGroup.add(chimMesh);

      } else {
        // Flat Roof with Overhang
        const roofGeo = new THREE.BoxGeometry(length + wallThk * 2 + 0.6, 0.25, width + wallThk * 2 + 0.6);
        const roofMesh = new THREE.Mesh(roofGeo, roofMat);
        roofMesh.position.set(0, height_m + 0.125, 0);
        roofMesh.castShadow = true;
        roofMesh.receiveShadow = true;
        shelterGroup.add(roofMesh);

        const parapetGeo = new THREE.BoxGeometry(length + wallThk * 2 + 0.7, 0.12, width + wallThk * 2 + 0.7);
        const parapetMat = new THREE.MeshStandardMaterial({ color: thermalMode ? 0xf97316 : 0x5c3d1e, roughness: 0.6 });
        const parapetMesh = new THREE.Mesh(parapetGeo, parapetMat);
        parapetMesh.position.set(0, height_m + 0.25 + 0.06, 0);
        shelterGroup.add(parapetMesh);
      }
    }

    // --- 5. Solar Vector Ray & Sun Celestial Marker ---
    if (showSun) {
      // Celestial Glowing Sun Sphere
      const sunSphereGeo = new THREE.SphereGeometry(Math.max(0.4, Math.max(length, width) * 0.08), 24, 24);
      const sunSphereMat = new THREE.MeshBasicMaterial({ color: 0xfbbf24 });
      const sunSphere = new THREE.Mesh(sunSphereGeo, sunSphereMat);
      sunSphere.position.set(sunX, sunY, sunZ);
      scene.add(sunSphere);

      // Sun Corona Glow
      const glowGeo = new THREE.SphereGeometry(Math.max(0.6, Math.max(length, width) * 0.12), 16, 16);
      const glowMat = new THREE.MeshBasicMaterial({ color: 0xf59e0b, transparent: true, opacity: 0.35 });
      const glowMesh = new THREE.Mesh(glowGeo, glowMat);
      glowMesh.position.set(sunX, sunY, sunZ);
      scene.add(glowMesh);

      // Solar Incident Vector Arrow pointing directly into the shelter center
      const targetPoint = new THREE.Vector3(0, height_m * 0.5, 0);
      const dir = new THREE.Vector3().subVectors(targetPoint, new THREE.Vector3(sunX, sunY, sunZ)).normalize();
      const arrowLength = sunDist * 0.85;
      const arrowHelper = new THREE.ArrowHelper(dir, new THREE.Vector3(sunX, sunY, sunZ), arrowLength, 0xf59e0b, 0.8, 0.4);
      scene.add(arrowHelper);
    }

    scene.add(shelterGroup);

    // --- Orbit Controls ---
    let isDragging = false;
    let prevMousePos = { x: 0, y: 0 };
    let spherical = { radius: camera.position.length(), theta: Math.PI / 4, phi: Math.PI / 3 };

    const updateCameraPos = () => {
      camera.position.x = spherical.radius * Math.sin(spherical.phi) * Math.cos(spherical.theta);
      camera.position.y = spherical.radius * Math.cos(spherical.phi);
      camera.position.z = spherical.radius * Math.sin(spherical.phi) * Math.sin(spherical.theta);
      camera.lookAt(0, height_m / 2, 0);
    };
    updateCameraPos();

    const onMouseDown = (e) => {
      isDragging = true;
      prevMousePos = { x: e.clientX, y: e.clientY };
    };

    const onMouseMove = (e) => {
      if (!isDragging) return;
      const deltaX = e.clientX - prevMousePos.x;
      const deltaY = e.clientY - prevMousePos.y;

      spherical.theta -= deltaX * 0.008;
      spherical.phi = Math.max(0.1, Math.min(Math.PI / 2 - 0.05, spherical.phi - deltaY * 0.008));

      updateCameraPos();
      prevMousePos = { x: e.clientX, y: e.clientY };
    };

    const onMouseUp = () => { isDragging = false; };

    const onWheel = (e) => {
      e.preventDefault();
      spherical.radius = Math.max(maxDim * 0.8, Math.min(maxDim * 5, spherical.radius + e.deltaY * 0.01));
      updateCameraPos();
    };

    const domElem = renderer.domElement;
    domElem.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    domElem.addEventListener('wheel', onWheel, { passive: false });

    let animId;
    const animate = () => {
      animId = requestAnimationFrame(animate);
      renderer.render(scene, camera);
    };
    animate();

    const handleResize = () => {
      if (!container) return;
      camera.aspect = container.clientWidth / container.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(container.clientWidth, container.clientHeight);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      cancelAnimationFrame(animId);
      domElem.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      domElem.removeEventListener('wheel', onWheel);
      window.removeEventListener('resize', handleResize);
      renderer.dispose();
    };
  }, [shape, length, width, height_m, wallThk, orientationDeg, sunAngle, wireframe, showRoof, showSun, thermalMode, roofType, rawOpenings, maxInsideTemp, minInsideTemp, ansysData]);

  return (    <div className="rounded-2xl border border-slate-800 bg-slate-950 overflow-hidden shadow-lg">
      {/* CAD Viewport Header */}
      <div className="bg-slate-900/90 border-b border-slate-800 px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-2.5">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="font-mono font-bold text-slate-200 uppercase tracking-wider text-[11px]">
            WebGL 3D Engine · {shape === 'dome' ? 'Igloo Hemisphere CAD' : 'Alpine Gable Shelter CAD'}
            {ansysData?.engine_used && (
              <span className={`ml-2 px-1.5 py-0.5 rounded text-[9px] ${
                ansysData.engine_used.includes('ansys') ? 'bg-emerald-900 text-emerald-300' : 'bg-sky-900 text-sky-300'
              }`}>
                {ansysData.engine_used.includes('ansys') ? 'ANSYS FEA' : 'Python FDM'}
              </span>
            )}
          </span>
        </div>

      </div>

      {/* Main Viewport Area */}
      <div className="relative bg-slate-950">
        {/* Interactive 3D WebGL Viewport — always the user's own design */}
        <div className="relative">
            <div
              ref={mountRef}
              style={{ width: '100%', height: height }}
              className="cursor-grab active:cursor-grabbing outline-none"
            />

            {/* Overlay Toolbar Controls (Left CAD HUD) */}
            <div className="absolute top-3 left-3 bg-slate-900/90 backdrop-blur-md rounded-xl p-2.5 shadow-xl border border-slate-700/80 flex flex-col gap-2 text-xs text-white">
              {/* Thermal Mode Switch */}
              <button
                type="button"
                onClick={() => setThermalMode(!thermalMode)}
                className={`px-3 py-1.5 rounded-lg font-mono text-[11px] font-bold flex items-center gap-2 transition-all border ${
                  thermalMode
                    ? 'bg-gradient-to-r from-rose-600 via-amber-500 to-sky-600 text-white border-white/20 shadow-md'
                    : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
                }`}
              >
                <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
                <span>{thermalMode ? 'FLIR Thermography: ON' : 'CAD Shaded Mode'}</span>
              </button>

              {/* Roof Style Toggle */}
              {shape !== 'dome' && (
                <div className="flex items-center justify-between gap-2 pt-1 border-t border-slate-800 font-mono text-[11px]">
                  <span className="text-slate-400">Roof Style:</span>
                  <div className="flex rounded-md overflow-hidden border border-slate-700 bg-slate-800 p-0.5">
                    <button
                      type="button"
                      onClick={() => setRoofType('pitched')}
                      className={`px-2 py-0.5 rounded ${roofType === 'pitched' ? 'bg-sky-600 text-white font-bold' : 'text-slate-400 hover:text-white'}`}
                    >
                      Gable
                    </button>
                    <button
                      type="button"
                      onClick={() => setRoofType('flat')}
                      className={`px-2 py-0.5 rounded ${roofType === 'flat' ? 'bg-sky-600 text-white font-bold' : 'text-slate-400 hover:text-white'}`}
                    >
                      Flat
                    </button>
                  </div>
                </div>
              )}

              <label className="flex items-center gap-2 text-slate-300 cursor-pointer hover:text-white pt-1 border-t border-slate-800 font-mono text-[11px]">
                <input
                  type="checkbox"
                  checked={showRoof}
                  onChange={(e) => setShowRoof(e.target.checked)}
                  className="accent-sky-500 rounded bg-slate-800 border-slate-700"
                />
                <span>Roof Cutaway</span>
              </label>

              <label className="flex items-center gap-2 text-slate-300 cursor-pointer hover:text-white font-mono text-[11px]">
                <input
                  type="checkbox"
                  checked={wireframe}
                  onChange={(e) => setWireframe(e.target.checked)}
                  className="accent-sky-500 rounded bg-slate-800 border-slate-700"
                />
                <span>FEA Wireframe</span>
              </label>

              <label className="flex items-center gap-2 text-slate-300 cursor-pointer hover:text-white font-mono text-[11px]">
                <input
                  type="checkbox"
                  checked={showSun}
                  onChange={(e) => setShowSun(e.target.checked)}
                  className="accent-sky-500 rounded bg-slate-800 border-slate-700"
                />
                <span>Solar Vector</span>
              </label>

              {/* Live Sun Orbit Phase Slider */}
              {showSun && (
                <div className="pt-2 border-t border-slate-800 space-y-1.5 font-mono text-[11px]">
                  <div className="flex items-center justify-between">
                    <span className="text-amber-400 font-bold flex items-center gap-1">
                      <span>☀️</span> Sun Angle:
                    </span>
                    <span className="text-slate-200 font-bold">
                      {Math.round(sunAngle)}° ({sunAngle <= 45 || sunAngle >= 315 ? 'North' : sunAngle < 135 ? 'East' : sunAngle <= 225 ? 'South' : 'West'})
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="360"
                    step="5"
                    value={sunAngle}
                    onChange={(e) => setSunAngle(parseFloat(e.target.value))}
                    className="w-full accent-amber-400 h-1.5 bg-slate-800 rounded cursor-pointer"
                  />
                  <div className="flex justify-between text-[9px] text-slate-400 pt-0.5">
                    <button type="button" onClick={() => setSunAngle(90)} className="hover:text-amber-300">East 90°</button>
                    <button type="button" onClick={() => setSunAngle(180)} className="hover:text-amber-300 font-bold text-amber-400">South 180°</button>
                    <button type="button" onClick={() => setSunAngle(270)} className="hover:text-amber-300">West 270°</button>
                  </div>
                </div>
              )}
            </div>

            {/* FLIR Infrared Thermal Temperature Scale Bar with Surface Readings */}
            {thermalMode && (
              <div className="absolute top-3 right-3 bg-slate-900/90 backdrop-blur-md rounded-xl p-2.5 border border-slate-700 shadow-2xl flex flex-col items-center text-white text-[11px] font-mono select-none">
                <span className="font-bold text-rose-400 mb-1">{scaleMaxTemp >= 0 ? '+' : ''}{scaleMaxTemp.toFixed(1)}°C</span>
                <div
                  className="w-3 rounded-sm my-1 shadow-inner"
                  style={{
                    height: '150px',
                    background: 'linear-gradient(to bottom, #ffffff, #ef4444, #f97316, #eab308, #84cc16, #06b6d4, #1d4ed8, #050b14)',
                  }}
                />
                <span className="font-bold text-sky-400 mt-1">{scaleMinTemp >= 0 ? '+' : ''}{scaleMinTemp.toFixed(1)}°C</span>
                <span className="text-[9px] text-slate-400 font-bold uppercase tracking-wider mt-1">
                  {surfTemps ? 'ANSYS FEA' : 'FLIR IR'}
                </span>
                {surfTemps && (
                  <div className="mt-2 pt-2 border-t border-slate-700 space-y-1 text-[9px] w-full">
                    {surfTemps.south_wall_inner_C != null && (
                      <div className="flex justify-between gap-2"><span className="text-slate-400">S Wall:</span><span className="text-amber-300">{surfTemps.south_wall_inner_C.toFixed(1)}°</span></div>
                    )}
                    {surfTemps.north_wall_inner_C != null && (
                      <div className="flex justify-between gap-2"><span className="text-slate-400">N Wall:</span><span className="text-sky-300">{surfTemps.north_wall_inner_C.toFixed(1)}°</span></div>
                    )}
                    {surfTemps.east_wall_inner_C != null && (
                      <div className="flex justify-between gap-2"><span className="text-slate-400">E Wall:</span><span className="text-slate-200">{surfTemps.east_wall_inner_C.toFixed(1)}°</span></div>
                    )}
                    {surfTemps.west_wall_inner_C != null && (
                      <div className="flex justify-between gap-2"><span className="text-slate-400">W Wall:</span><span className="text-slate-200">{surfTemps.west_wall_inner_C.toFixed(1)}°</span></div>
                    )}
                    {surfTemps.roof_inner_C != null && (
                      <div className="flex justify-between gap-2"><span className="text-slate-400">Roof:</span><span className="text-slate-200">{surfTemps.roof_inner_C.toFixed(1)}°</span></div>
                    )}
                    {surfTemps.floor_surface_C != null && (
                      <div className="flex justify-between gap-2"><span className="text-slate-400">Floor:</span><span className="text-emerald-300">{surfTemps.floor_surface_C.toFixed(1)}°</span></div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Instruction Navigation Hint */}
            <div className="absolute bottom-3 left-3 bg-slate-900/80 backdrop-blur-sm rounded-lg px-2.5 py-1 text-[11px] font-mono text-slate-400 border border-slate-800 flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-slate-500" />
              <span>Rotate: Left Click · Pan: Right Click · Zoom: Wheel</span>
            </div>
          </div>
      </div>

      {/* Model Spec Engineering Telemetry Bar */}
      <div className="bg-slate-900/95 px-5 py-3 border-t border-slate-800 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-mono">
        <div>
          <span className="text-slate-400 block text-[10px] uppercase">Envelope Form:</span>
          <span className="font-semibold text-slate-200">{shape === 'dome' ? 'Igloo Hemisphere' : roofType === 'pitched' ? 'Alpine Gable Pitched' : 'Flat Slab Overhang'}</span>
        </div>
        <div>
          <span className="text-slate-400 block text-[10px] uppercase">Dimensions:</span>
          <span className="font-semibold text-slate-200">{length}m × {width}m × {height_m}m</span>
        </div>
        <div>
          <span className="text-slate-400 block text-[10px] uppercase">Wall Assembly:</span>
          <span className="font-semibold text-sky-400">{(wallThk * 100).toFixed(0)}cm Mud Brick</span>
        </div>
        <div>
          <span className="text-slate-400 block text-[10px] uppercase">Solar Azimuth:</span>
          <span className="font-semibold text-amber-400">{orientationDeg}° ({orientationDeg === 180 ? 'South Direct' : 'Offset'})</span>
        </div>
      </div>
    </div>
  );
}
