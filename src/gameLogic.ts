import { Vector2D, Island, Port, WindState, ShallowZone, IceFloe } from './types';

export function initWind(): WindState {
  const direction = Math.random() * Math.PI * 2;
  const strength = 0.1 + Math.random() * 0.3;
  return {
    direction,
    strength,
    targetDirection: direction + (Math.random() - 0.5) * 0.5,
    targetStrength: 0.1 + Math.random() * 0.4
  };
}

export function updateWind(wind: WindState, dt: number): WindState {
  const next = { ...wind };
  
  // Smoothly move towards target
  const dirDiff = Math.atan2(Math.sin(next.targetDirection - next.direction), Math.cos(next.targetDirection - next.direction));
  next.direction += dirDiff * dt * 0.1;
  next.strength += (next.targetStrength - next.strength) * dt * 0.1;

  // If close to target, pick a new one
  if (Math.abs(dirDiff) < 0.05 && Math.abs(next.targetStrength - next.strength) < 0.05) {
    next.targetDirection = next.direction + (Math.random() - 0.5) * 1.0; // Max 0.5 rad change
    next.targetStrength = 0.05 + Math.random() * 0.6;
  }

  return next;
}

export function generateWorld(width: number, height: number, islandCount: number = 45): { islands: Island[], shallowZones: ShallowZone[], startPort: Port, endPort: Port, iceFloes: IceFloe[] } {
  const islands: Island[] = [];
  const shallowZones: ShallowZone[] = [];
  const iceFloes: IceFloe[] = [];
  
  // Ports at opposite ends
  const startPort: Port = {
    x: 20,
    y: height / 2 - 75,
    width: 120,
    height: 150,
    isDestination: false
  };

  const endPort: Port = {
    x: width - 80,
    y: height / 2 - 37.5,
    width: 60,
    height: 75,
    isDestination: true
  };

  // Create a winding path using waypoints
  const waypoints: Vector2D[] = [
    { x: startPort.x + startPort.width, y: startPort.y + startPort.height / 2 },
    { x: width * 0.25, y: height * (0.1 + Math.random() * 0.8) },
    { x: width * 0.5, y: height * (0.1 + Math.random() * 0.8) },
    { x: width * 0.75, y: height * (0.1 + Math.random() * 0.8) },
    { x: endPort.x, y: endPort.y + endPort.height / 2 }
  ];

  const pathRadius = 120; // Increased for better clearance
  const deepPathRadius = 160; // Increased for better clearance

  // 1. Generate islands first
  for (let i = 0; i < islandCount; i++) {
    let island: Island;
    let valid = false;
    let attempts = 0;

    while (!valid && attempts < 400) {
      attempts++;
      const radius = 20 + Math.random() * 50; // Slightly smaller islands for better paths
      const x = 150 + Math.random() * (width - 300);
      const y = Math.random() * height;

      island = {
        x,
        y,
        radius,
        points: generateIslandPoints(radius)
      };

      // Check distance to ports
      const distToStart = Math.hypot(island.x - (startPort.x + startPort.width/2), island.y - (startPort.y + startPort.height/2));
      const distToEnd = Math.hypot(island.x - (endPort.x + endPort.width/2), island.y - (endPort.y + endPort.height/2));

      if (distToStart < radius + 150 || distToEnd < radius + 150) continue;

      // Check distance to the winding path
      let minPathDist = Infinity;
      for (let j = 0; j < waypoints.length - 1; j++) {
        const d = distToSegment(island, waypoints[j], waypoints[j+1]);
        minPathDist = Math.min(minPathDist, d);
      }

      // Stricter path clearance
      if (minPathDist < pathRadius + radius) {
        continue; // No islands on the main path
      }

      // Check distance to existing islands to avoid clusters blocking paths
      let tooCloseToOther = false;
      for (const other of islands) {
        if (Math.hypot(island.x - other.x, island.y - other.y) < (island.radius + other.radius) * 1.8) {
          tooCloseToOther = true;
          break;
        }
      }
      if (tooCloseToOther) continue;

      valid = true;
      islands.push(island);

      // 2. Add a shallow "shelf" around the island
      // Ensure the shelf doesn't block the deep path
      const shelfRadius = island.radius * (2.0 + Math.random() * 1.5);
      // If the shelf would reach the path center, shrink it
      const safeShelfRadius = Math.min(shelfRadius, minPathDist - 60);
      
      if (safeShelfRadius > island.radius) {
        shallowZones.push({
          x: island.x,
          y: island.y,
          radius: safeShelfRadius,
          depth: 2 + Math.random() * 4, // Very shallow near island
          points: island.points.map(p => ({
            x: p.x * (1.5 + Math.random() * 1.0),
            y: p.y * (1.5 + Math.random() * 1.0)
          }))
        });
      }
    }
  }

  // 3. Generate random shoals (some can be near the path now)
  for (let i = 0; i < 60; i++) {
    const x = Math.random() * width;
    const y = Math.random() * height;
    const radius = 40 + Math.random() * 120;
    const depth = 5 + Math.random() * 15; // 5m to 20m depth

    // Check if it's on the main path
    let minPathDist = Infinity;
    for (let j = 0; j < waypoints.length - 1; j++) {
      const d = distToSegment({ x, y }, waypoints[j], waypoints[j+1]);
      minPathDist = Math.min(minPathDist, d);
    }

    // If on path, ensure it's not too shallow or too large
    if (minPathDist < 120) {
      // On path shoals are deeper (at least 27m for the very center of the path)
      // We'll skip placing very shallow ones directly on the path center
      if (minPathDist < 60) continue; 
      
      // Place slightly deeper shoals near the path edges
      const r = 30 + Math.random() * 40;
      shallowZones.push({ 
        x, 
        y, 
        radius: r, 
        depth: 22 + Math.random() * 5,
        points: generateIslandPoints(r) // Reuse island point gen for blob shapes
      });
    } else {
      shallowZones.push({ 
        x, 
        y, 
        radius, 
        depth,
        points: generateIslandPoints(radius)
      });
    }
  }

  // 4. Generate Ice Floes
  const iceFloeCount = 4 + Math.floor(Math.random() * 5);
  for (let i = 0; i < iceFloeCount; i++) {
    const radius = 15 + Math.random() * 35;
    const x = 200 + Math.random() * (width - 400);
    const y = Math.random() * height;
    
    // Ensure not spawning on island or other ice floe
    let collision = false;
    for (const island of islands) {
      if (Math.hypot(x - island.x, y - island.y) < radius + island.radius + 20) {
        collision = true;
        break;
      }
    }
    if (!collision) {
      for (const other of iceFloes) {
        if (Math.hypot(x - other.pos.x, y - other.pos.y) < radius + other.radius + 20) {
          collision = true;
          break;
        }
      }
    }
    
    if (collision) {
      i--;
      continue;
    }

    iceFloes.push({
      pos: { x, y },
      velocity: { x: 0, y: 0 },
      radius,
      points: generateIceFloePoints(radius),
      stuck: false,
      lastSplitTime: 0,
      windSensitivity: 0.9 + Math.random() * 0.2 // 10% variation
    });
  }

  return { islands, shallowZones, startPort, endPort, iceFloes };
}

export function getDepthAt(pos: Vector2D, shallowZones: ShallowZone[]): number {
  let minDepth = 35; // Default deep water
  for (const zone of shallowZones) {
    const dist = Math.hypot(pos.x - zone.x, pos.y - zone.y);
    if (dist < zone.radius) {
      // Smooth interpolation for depth
      const factor = 1 - (dist / zone.radius);
      // Use a power function for a more natural "shelf" profile
      const smoothFactor = Math.pow(factor, 0.7);
      const zoneDepth = zone.depth + (35 - zone.depth) * (1 - smoothFactor);
      minDepth = Math.min(minDepth, zoneDepth);
    }
  }
  
  // Add a small amount of random "noise" to the depth (simulating uneven seabed)
  // We use a deterministic-ish noise based on position to avoid flickering
  const noise = (Math.sin(pos.x * 0.05) * Math.cos(pos.y * 0.05)) * 0.5;
  
  return Math.max(1, minDepth + noise);
}

function distToSegment(p: Vector2D, v: Vector2D, w: Vector2D): number {
  const l2 = Math.hypot(v.x - w.x, v.y - w.y) ** 2;
  if (l2 === 0) return Math.hypot(p.x - v.x, p.y - v.y);
  let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (v.x + t * (w.x - v.x)), p.y - (v.y + t * (w.y - v.y)));
}

function generateIslandPoints(radius: number): Vector2D[] {
  const points: Vector2D[] = [];
  const segments = 12 + Math.floor(Math.random() * 8);
  for (let i = 0; i < segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    const r = radius * (0.8 + Math.random() * 0.4);
    points.push({
      x: Math.cos(angle) * r,
      y: Math.sin(angle) * r
    });
  }
  return points;
}

function generateIceFloePoints(radius: number): Vector2D[] {
  const points: Vector2D[] = [];
  const segments = 7 + Math.floor(Math.random() * 3); // More consistent segment count
  for (let i = 0; i < segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    // Less radical shape variation (85% to 115% of radius)
    const r = radius * (0.85 + Math.random() * 0.3);
    points.push({
      x: Math.cos(angle) * r,
      y: Math.sin(angle) * r
    });
  }
  return points;
}

export function updateIceFloes(iceFloes: IceFloe[], wind: WindState, islands: Island[], shipPos: Vector2D, shipRadius: number, dt: number, width: number, height: number, currentTime: number): IceFloe[] {
  let nextFloes: IceFloe[] = [];
  const SPLIT_COOLDOWN = 5000;
  const MIN_SPLIT_RADIUS = 12; // Slightly larger minimum for splitting

  // 1. Move all floes based on wind
  const movedFloes = iceFloes.map(floe => {
    if (floe.stuck) return { ...floe };

    const next = { ...floe, velocity: { ...floe.velocity }, pos: { ...floe.pos } };
    
    const sizeFactor = 50 / floe.radius;
    // Apply individual wind sensitivity (10% variation)
    const windEffect = wind.strength * sizeFactor * 15 * (floe.windSensitivity || 1.0);
    
    next.velocity.x = Math.cos(wind.direction) * windEffect;
    next.velocity.y = Math.sin(wind.direction) * windEffect;

    next.pos.x += next.velocity.x * dt;
    next.pos.y += next.velocity.y * dt;

    // Screen wrapping
    if (next.pos.x < 0) next.pos.x = width;
    if (next.pos.x > width) next.pos.x = 0;
    if (next.pos.y < 0) next.pos.y = height;
    if (next.pos.y > height) next.pos.y = 0;

    return next;
  });

  // 2. Check for collisions that trigger splitting
  const toSplit = new Set<number>();
  
  for (let i = 0; i < movedFloes.length; i++) {
    const floe = movedFloes[i];
    if (currentTime - (floe.lastSplitTime || 0) < SPLIT_COOLDOWN || floe.radius < MIN_SPLIT_RADIUS) continue;

    let collided = false;

    // Hit island?
    for (const island of islands) {
      if (Math.hypot(floe.pos.x - island.x, floe.pos.y - island.y) < floe.radius + island.radius) {
        collided = true;
        floe.stuck = true; // Also stick it
        break;
      }
    }

    // Hit ship?
    if (!collided) {
      if (Math.hypot(floe.pos.x - shipPos.x, floe.pos.y - shipPos.y) < floe.radius + shipRadius) {
        collided = true;
      }
    }

    // Hit other floe?
    if (!collided) {
      for (let j = 0; j < movedFloes.length; j++) {
        if (i === j) continue;
        const other = movedFloes[j];
        if (Math.hypot(floe.pos.x - other.pos.x, floe.pos.y - other.pos.y) < floe.radius + other.radius) {
          collided = true;
          break;
        }
      }
    }

    if (collided) {
      toSplit.add(i);
    }
  }

  // 3. Process splitting and relaxation
  for (let i = 0; i < movedFloes.length; i++) {
    const floe = movedFloes[i];
    if (toSplit.has(i)) {
      // Split into two
      const newRadius = floe.radius * 0.68; // Slightly larger pieces for "softer" feel
      const offset = floe.radius * 0.35; // Smaller offset for softer feel
      
      for (let k = 0; k < 2; k++) {
        const angle = Math.random() * Math.PI * 2;
        nextFloes.push({
          pos: {
            x: floe.pos.x + Math.cos(angle) * offset,
            y: floe.pos.y + Math.sin(angle) * offset
          },
          velocity: { x: 0, y: 0 },
          radius: newRadius,
          points: generateIceFloePoints(newRadius),
          stuck: false,
          lastSplitTime: currentTime,
          windSensitivity: 0.9 + Math.random() * 0.2
        });
      }
    } else {
      nextFloes.push(floe);
    }
  }

  // 4. Resolve collisions (relaxation)
  for (let iter = 0; iter < 2; iter++) {
    // Floe vs Floe
    for (let i = 0; i < nextFloes.length; i++) {
      for (let j = i + 1; j < nextFloes.length; j++) {
        const a = nextFloes[i];
        const b = nextFloes[j];
        const dx = b.pos.x - a.pos.x;
        const dy = b.pos.y - a.pos.y;
        const dist = Math.hypot(dx, dy);
        const minDist = a.radius + b.radius;

        if (dist < minDist && dist > 0) {
          const overlap = minDist - dist;
          const nx = dx / dist;
          const ny = dy / dist;
          
          if (a.stuck && !b.stuck) {
            b.pos.x += nx * overlap;
            b.pos.y += ny * overlap;
          } else if (b.stuck && !a.stuck) {
            a.pos.x -= nx * overlap;
            a.pos.y -= ny * overlap;
          } else if (!a.stuck && !b.stuck) {
            a.pos.x -= nx * overlap * 0.5;
            a.pos.y -= ny * overlap * 0.5;
            b.pos.x += nx * overlap * 0.5;
            b.pos.y += ny * overlap * 0.5;
          }
        }
      }
    }

    // Floe vs Island & Ship
    for (let i = 0; i < nextFloes.length; i++) {
      const floe = nextFloes[i];
      
      // Island
      for (const island of islands) {
        const dx = floe.pos.x - island.x;
        const dy = floe.pos.y - island.y;
        const dist = Math.hypot(dx, dy);
        const minDist = floe.radius + island.radius;
        if (dist < minDist && dist > 0) {
          const overlap = minDist - dist;
          floe.pos.x += (dx / dist) * overlap;
          floe.pos.y += (dy / dist) * overlap;
          floe.stuck = true;
        }
      }

      // Ship
      const dx = floe.pos.x - shipPos.x;
      const dy = floe.pos.y - shipPos.y;
      const dist = Math.hypot(dx, dy);
      const minDist = floe.radius + shipRadius;
      if (dist < minDist && dist > 0) {
        const overlap = minDist - dist;
        floe.pos.x += (dx / dist) * overlap;
        floe.pos.y += (dy / dist) * overlap;
      }
    }
  }

  // Prune tiny floes or too many floes
  if (nextFloes.length > 20) {
    nextFloes.sort((a, b) => b.radius - a.radius);
    nextFloes = nextFloes.slice(0, 20);
  }

  return nextFloes;
}

export function checkCollision(shipPos: Vector2D, shipRadius: number, shipSpeed: number, islands: Island[], iceFloes: IceFloe[]): boolean {
  // Only break if speed >= 2 knots
  // Speed in game is roughly 0.5 * pixels/frame. 2 knots is speed ~4.0
  if (shipSpeed < 4.0) return false;

  // Check islands
  for (const island of islands) {
    const dist = Math.hypot(shipPos.x - island.x, shipPos.y - island.y);
    if (dist < island.radius + shipRadius) {
      return true;
    }
  }
  // Check ice floes
  for (const floe of iceFloes) {
    const dist = Math.hypot(shipPos.x - floe.pos.x, shipPos.y - floe.pos.y);
    if (dist < floe.radius + shipRadius) {
      return true;
    }
  }
  return false;
}

export function checkInPort(shipPos: Vector2D, port: Port): boolean {
  return (
    shipPos.x > port.x &&
    shipPos.x < port.x + port.width &&
    shipPos.y > port.y &&
    shipPos.y < port.y + port.height
  );
}
