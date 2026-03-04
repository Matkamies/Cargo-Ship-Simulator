import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Anchor, Navigation, Wind, Weight, Play, RotateCcw, CheckCircle2, AlertTriangle } from 'lucide-react';
import { ShipState, Island, Port, GameConfig, WindState, ShallowZone, IceFloe } from './types';
import { generateWorld, checkCollision, checkInPort, initWind, updateWind, getDepthAt, updateIceFloes } from './gameLogic';

const BASE_SHIP_WIDTH = 32;
const SHIP_HEIGHT = 12;

export default function App() {
  const [gameState, setGameState] = useState<'menu' | 'playing' | 'won' | 'crashed'>('menu');
  const [cargo, setCargo] = useState(50);
  const [finalPayout, setFinalPayout] = useState({ total: 0, initial: 0, timePenalty: 0, fuelCost: 0 });
  const [ship, setShip] = useState<ShipState>({
    pos: { x: 100, y: 0 },
    velocity: { x: 0, y: 0 },
    heading: 0,
    angularVelocity: 0,
    throttle: 0,
    rudder: 0,
    bowThruster: 0,
    cargo: 50,
    path: [],
    wake: [],
    fuel: 100,
    startTime: 0,
  });

  const shipWidth = BASE_SHIP_WIDTH * (1 + ship.cargo / 100);
  const shipRadius = shipWidth / 2.8;

  const lastPathPointRef = useRef<{x: number, y: number} | null>(null);
  const [world, setWorld] = useState<{ islands: Island[], shallowZones: ShallowZone[], startPort: Port, endPort: Port, iceFloes: IceFloe[] } | null>(null);
  const [wind, setWind] = useState<WindState>(initWind());
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const requestRef = useRef<number>(null);
  const keys = useRef<Set<string>>(new Set());

  const initGame = useCallback(() => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const newWorld = generateWorld(w, h);
    setWorld(newWorld);
    setWind(initWind());
    setShip({
      pos: { x: newWorld.startPort.x + newWorld.startPort.width / 2, y: newWorld.startPort.y + newWorld.startPort.height / 2 },
      velocity: { x: 0, y: 0 },
      heading: 0,
      angularVelocity: 0,
      throttle: 0,
      rudder: 0,
      bowThruster: 0,
      cargo: cargo,
      path: [{ x: newWorld.startPort.x + newWorld.startPort.width / 2, y: newWorld.startPort.y + newWorld.startPort.height / 2 }],
      wake: [],
      fuel: 100,
      startTime: Date.now(),
    });
    lastPathPointRef.current = { x: newWorld.startPort.x + newWorld.startPort.width / 2, y: newWorld.startPort.y + newWorld.startPort.height / 2 };
    setGameState('playing');
  }, [cargo]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      keys.current.add(e.code);
      
      if (gameState !== 'playing') return;

      const THROTTLE_STEP = 0.25;
      const BT_STEP = 0.1;
      const RUDDER_STEP = 0.1;

      setShip(prev => {
        const next = { ...prev };
        let changed = false;

        if (e.code === 'ArrowUp' || e.code === 'KeyW') {
          next.throttle = Math.min(next.throttle + THROTTLE_STEP, 1);
          changed = true;
        } else if (e.code === 'ArrowDown' || e.code === 'KeyS') {
          next.throttle = Math.max(next.throttle - THROTTLE_STEP, -0.5);
          changed = true;
        } else if (e.code === 'ArrowLeft' || e.code === 'KeyA') {
          next.rudder = Math.max(next.rudder - RUDDER_STEP, -1);
          changed = true;
        } else if (e.code === 'ArrowRight' || e.code === 'KeyD') {
          next.rudder = Math.min(next.rudder + RUDDER_STEP, 1);
          changed = true;
        } else if (e.code === 'KeyQ') {
          next.bowThruster = Math.max(next.bowThruster - BT_STEP, -1);
          changed = true;
        } else if (e.code === 'KeyE') {
          next.bowThruster = Math.min(next.bowThruster + BT_STEP, 1);
          changed = true;
        }

        if (changed) {
          // Fix floating point precision and snap to zero
          next.throttle = Math.abs(next.throttle) < 0.01 ? 0 : Math.round(next.throttle * 4) / 4;
          next.rudder = Math.abs(next.rudder) < 0.01 ? 0 : Math.round(next.rudder * 10) / 10;
          next.bowThruster = Math.abs(next.bowThruster) < 0.01 ? 0 : Math.round(next.bowThruster * 10) / 10;
          return next;
        }
        return prev;
      });
    };
    const handleKeyUp = (e: KeyboardEvent) => keys.current.delete(e.code);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [gameState]);

  const updatePhysics = useCallback((dt: number) => {
    if (gameState !== 'playing' || !world) return;

    setWind(prev => updateWind(prev, dt));

    setShip(prev => {
      const next = { ...prev };
      
      // Physics Constants based on Cargo
      const mass = 1.0 + (next.cargo / 100) * 4.0; 
      const inertia = 1.0 + (next.cargo / 100) * 3.0;
      
      const enginePower = (1.635 + (next.cargo / 100) * 4.14) / mass; 
      const rudderEffectiveness = 0.225 / inertia;
      const bowThrusterPower = 0.5 / mass;
      const waterDrag = 0.9992;
      const angularDrag = 0.985;

      // Current speed for effectiveness calculations
      const currentSpeed = Math.hypot(next.velocity.x, next.velocity.y);

      // Bow thruster effectiveness decreases with speed
      // Above ~10 knots (speed 20), thrusters are very weak
      const btEffectiveness = Math.max(0.05, 1.0 - (currentSpeed / 20));
      const effectiveBTForce = bowThrusterPower * btEffectiveness;

      // Wind effect (tankers have large surface area, especially on the side)
      const relWindAngle = wind.direction - next.heading;
      const sideImpact = Math.abs(Math.sin(relWindAngle));
      const frontalImpact = Math.abs(Math.cos(relWindAngle)) * 0.2; // Front is much less affected
      const totalWindImpact = (sideImpact + frontalImpact) * wind.strength * 0.675 / mass;
      
      const windForceX = Math.cos(wind.direction) * totalWindImpact;
      const windForceY = Math.sin(wind.direction) * totalWindImpact;

      // Calculate forces
      const forceX = Math.cos(next.heading) * next.throttle * enginePower;
      const forceY = Math.sin(next.heading) * next.throttle * enginePower;

      // Bow thruster force
      const btForceX = -Math.sin(next.heading) * next.bowThruster * effectiveBTForce;
      const btForceY = Math.cos(next.heading) * next.bowThruster * effectiveBTForce;

      // Update velocity
      next.velocity.x += (forceX + btForceX + windForceX) * dt;
      next.velocity.y += (forceY + btForceY + windForceY) * dt;

      // "Biting the water" physics:
      // Decompose velocity into forward and lateral components
      const speed = Math.hypot(next.velocity.x, next.velocity.y);
      const forwardDirX = Math.cos(next.heading);
      const forwardDirY = Math.sin(next.heading);
      const sideDirX = -Math.sin(next.heading);
      const sideDirY = Math.cos(next.heading);

      // Project velocity onto forward and side vectors
      const velForward = next.velocity.x * forwardDirX + next.velocity.y * forwardDirY;
      const velSide = next.velocity.x * sideDirX + next.velocity.y * sideDirY;

      // Apply drag
      let finalVelForward = velForward * waterDrag;
      
      // Lateral drag increases with speed to "bite" the water
      const lateralBiteFactor = 0.9 + (speed / 50) * 0.08; 
      const lateralDrag = Math.max(0.8, 1.0 - (0.05 * lateralBiteFactor)); 
      let finalVelSide = velSide * lateralDrag;

      // Reconstruct velocity
      next.velocity.x = finalVelForward * forwardDirX + finalVelSide * sideDirX;
      next.velocity.y = finalVelForward * forwardDirY + finalVelSide * sideDirY;

      // Update position
      next.pos.x += next.velocity.x * dt;
      next.pos.y += next.velocity.y * dt;

      // Update rotation
      const rudderSpeedFactor = Math.min(1.0, speed / 35);
      const turnPower = next.rudder * rudderEffectiveness * rudderSpeedFactor;
      
      // Wind also adds a small torque if not perfectly aligned
      const windAngleDiff = Math.sin(wind.direction - next.heading);
      const windTorque = windAngleDiff * wind.strength * 0.0675 / inertia;

      const btTorque = next.bowThruster * effectiveBTForce * 0.5;
      
      next.angularVelocity += (turnPower + btTorque + windTorque) * dt * 6;
      next.angularVelocity *= angularDrag;
      next.heading += next.angularVelocity * dt;

      // Fuel consumption
      // 0.99% per second at full throttle = ~100 seconds for full tank
      const fuelRate = 0.99; 
      const consumption = (Math.abs(next.throttle) + Math.abs(next.bowThruster) * 2) * fuelRate * dt;
      next.fuel = Math.max(0, next.fuel - consumption);

      if (next.fuel <= 0 && speed < 1) {
        // If out of fuel and stopped, game over (or just can't move)
        // For now, let's just let them drift if they have momentum
        next.throttle = 0;
        next.bowThruster = 0;
      }

      // Update path
      if (lastPathPointRef.current) {
        const dist = Math.hypot(next.pos.x - lastPathPointRef.current.x, next.pos.y - lastPathPointRef.current.y);
        if (dist > 15) {
          next.path.push({ x: next.pos.x, y: next.pos.y });
          lastPathPointRef.current = { x: next.pos.x, y: next.pos.y };
        }
      }

      // Update wake
      if (!next.wake) next.wake = [];
      const wakeInterval = 6; // Slightly more frequent for smoother look
      const lastWakePoint = next.wake[next.wake.length - 1];
      const distSinceLastWake = lastWakePoint ? Math.hypot(next.pos.x - lastWakePoint.pos.x, next.pos.y - lastWakePoint.pos.y) : 100;
      
      if (distSinceLastWake > wakeInterval && speed > 2.0) {
        const speedFactor = Math.min(1, (speed - 2.0) / 33); // Adjust factor to start at 2kn
        next.wake.push({
          pos: { x: next.pos.x, y: next.pos.y },
          heading: next.heading,
          opacity: 0.25 * speedFactor, // Dynamic opacity based on speed
          width: shipWidth * (0.6 + 0.4 * speedFactor) // Slightly wider at speed
        });
      }

      // Fade and prune wake (slowly)
      // Slowed down by 100% (halved the decay rate)
      next.wake = next.wake.map(w => ({ 
        ...w, 
        opacity: w.opacity - 0.0002 * dt * 60, 
        width: w.width + 0.02 * dt * 60 
      })).filter(w => w.opacity > 0);

      // Collision detection
      if (checkCollision(next.pos, shipRadius, speed, world.islands, world.iceFloes)) {
        setGameState('crashed');
      }

      // Update ice floes
      const updatedIceFloes = updateIceFloes(world.iceFloes, wind, world.islands, next.pos, shipRadius, dt, window.innerWidth, window.innerHeight, Date.now());
      setWorld(prev => prev ? { ...prev, iceFloes: updatedIceFloes } : null);

      // Depth check
      const currentDepth = getDepthAt(next.pos, world.shallowZones);
      const draft = 6 + (next.cargo / 100) * 19;
      if (currentDepth < draft) {
        setGameState('crashed');
      }

      // Out of fuel check
      if (next.fuel <= 0 && speed < 0.1) {
        setGameState('crashed');
      }

      // Check win condition
      if (checkInPort(next.pos, world.endPort) && speed < 4) {
        const initialReward = (next.cargo / 100) * 100000;
        const elapsedTime = (Date.now() - next.startTime) / 1000;
        const timePenalty = initialReward * (1 - Math.max(0, 1 - elapsedTime / 300));
        const fuelCost = (100 - next.fuel) * 100;
        const total = Math.max(0, initialReward - timePenalty - fuelCost);
        
        setFinalPayout({
          total,
          initial: initialReward,
          timePenalty,
          fuelCost
        });
        setGameState('won');
      }

      return next;
    });
  }, [gameState, world]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !world) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw Water (Deepest)
    ctx.fillStyle = '#040a1a'; // Deep nautical blue
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const draft = 6 + (ship.cargo / 100) * 19;

    // 1. Draw "Lightening" Glows (Soft radial gradients for depth transition)
    // Shallower water is lighter blue, using soft gradients as requested
    ctx.save();
    // Sort zones to draw shallower ones with more priority
    [...world.shallowZones].sort((a, b) => b.depth - a.depth).forEach(zone => {
      const gradient = ctx.createRadialGradient(zone.x, zone.y, 0, zone.x, zone.y, zone.radius);
      const depthFactor = 1 - zone.depth / 35;
      const intensity = 0.6 * Math.pow(depthFactor, 1.1);
      
      // Pure blue shades only
      gradient.addColorStop(0, `rgba(37, 99, 235, ${intensity})`); // Bright blue
      gradient.addColorStop(0.6, `rgba(30, 58, 138, ${intensity * 0.4})`); // Mid blue
      gradient.addColorStop(1, 'rgba(4, 10, 26, 0)'); // Fade to deep background
      
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(zone.x, zone.y, zone.radius, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.restore();

    // 2. Draw Contour Lines (Irregular shapes, union only)
    // We use a temporary canvas and 'source-out' to draw ONLY the outer edge of the unioned shapes.
    // This avoids internal lines AND prevents any color fill leaks (no more purple!).
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = canvas.width;
    tempCanvas.height = canvas.height;
    const tempCtx = tempCanvas.getContext('2d');

    const drawUnionOutline = (depth: number, color: string, width: number) => {
      if (!tempCtx) return;
      tempCtx.clearRect(0, 0, tempCanvas.width, tempCanvas.height);
      
      const createPath = (c: CanvasRenderingContext2D) => {
        c.beginPath();
        world.shallowZones.forEach(zone => {
          if (zone.depth < depth && zone.points) {
            const scale = (depth - zone.depth) / (35 - zone.depth);
            if (scale > 0) {
              c.moveTo(zone.x + zone.points[0].x * scale, zone.y + zone.points[0].y * scale);
              zone.points.forEach(p => c.lineTo(zone.x + p.x * scale, zone.y + p.y * scale));
              c.closePath();
            }
          }
        });
      };

      // 1. Fill the entire union area with an opaque color on the temporary canvas
      tempCtx.globalCompositeOperation = 'source-over';
      tempCtx.fillStyle = 'black';
      createPath(tempCtx);
      tempCtx.fill();

      // 2. Use 'source-out' to draw the stroke ONLY where the canvas is currently empty.
      // Since the union area is filled, the stroke will only be drawn on the OUTSIDE edge.
      tempCtx.globalCompositeOperation = 'source-out';
      tempCtx.strokeStyle = color;
      tempCtx.lineWidth = width * 2; // Double width because only the outer half is visible
      createPath(tempCtx);
      tempCtx.stroke();

      // 3. Draw the resulting clean outline onto the main canvas
      ctx.drawImage(tempCanvas, 0, 0);
    };

    // 30m Contour (Subtle white/blue)
    drawUnionOutline(30, 'rgba(255, 255, 255, 0.1)', 1);
    // 20m Contour
    drawUnionOutline(20, 'rgba(255, 255, 255, 0.15)', 1);
    // 10m Contour
    drawUnionOutline(10, 'rgba(255, 255, 255, 0.2)', 1);

    // 3. Danger Zone (Subtle Red Outline Only)
    // This now draws ONLY a red line at the boundary. No red fill = no purple water.
    const safetyMargin = 2;
    const dangerDepth = draft + safetyMargin;
    drawUnionOutline(dangerDepth, 'rgba(239, 68, 68, 0.7)', 1.5);

    // Draw Grid (Subtle)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 1;
    for (let x = 0; x < canvas.width; x += 100) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvas.height);
      ctx.stroke();
    }
    for (let y = 0; y < canvas.height; y += 100) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(canvas.width, y);
      ctx.stroke();
    }

    // Draw Ship Path
    if (ship.path.length > 1) {
      ctx.save();
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 2;
      ctx.setLineDash([10, 10]);
      ctx.globalAlpha = 0.6;
      ctx.beginPath();
      ctx.moveTo(ship.path[0].x, ship.path[0].y);
      for (let i = 1; i < ship.path.length; i++) {
        ctx.lineTo(ship.path[i].x, ship.path[i].y);
      }
      // Connect to current ship position (stern)
      const sternX = ship.pos.x - Math.cos(ship.heading) * (shipWidth / 2);
      const sternY = ship.pos.y - Math.sin(ship.heading) * (shipWidth / 2);
      ctx.lineTo(sternX, sternY);
      ctx.stroke();
      ctx.restore();
    }

    // Draw Ports
    [world.startPort, world.endPort].forEach(port => {
      ctx.fillStyle = port.isDestination ? 'rgba(34, 197, 94, 0.2)' : 'rgba(59, 130, 246, 0.2)';
      ctx.strokeStyle = port.isDestination ? '#22c55e' : '#3b82f6';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 5]);
      ctx.strokeRect(port.x, port.y, port.width, port.height);
      ctx.fillRect(port.x, port.y, port.width, port.height);
      ctx.setLineDash([]);
      
      ctx.fillStyle = port.isDestination ? '#22c55e' : '#3b82f6';
      ctx.font = '12px "JetBrains Mono"';
      ctx.fillText(port.isDestination ? 'DESTINATION PORT' : 'STARTING PORT', port.x + 10, port.y + 20);
    });

    // Draw Islands
    world.islands.forEach(island => {
      // Draw Rocky Shore
      ctx.beginPath();
      ctx.moveTo(island.x + island.points[0].x, island.y + island.points[0].y);
      island.points.forEach(p => ctx.lineTo(island.x + p.x, island.y + p.y));
      ctx.closePath();
      ctx.fillStyle = '#64748b'; // Slate gray for rocks
      ctx.fill();
      ctx.strokeStyle = '#475569';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Draw Green Interior (Vegetation)
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(island.x + island.points[0].x * 0.7, island.y + island.points[0].y * 0.7);
      island.points.forEach(p => ctx.lineTo(island.x + p.x * 0.7, island.y + p.y * 0.7));
      ctx.closePath();
      ctx.fillStyle = '#166534'; // Dark green
      ctx.fill();
      
      // Add some "trees" (dots)
      ctx.fillStyle = '#14532d';
      for (let i = 0; i < 5; i++) {
        const tx = island.x + (Math.sin(island.x + i) * island.radius * 0.4);
        const ty = island.y + (Math.cos(island.y + i) * island.radius * 0.4);
        ctx.beginPath();
        ctx.arc(tx, ty, 3, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    });

    // Draw Wake
    ship.wake.forEach(w => {
      ctx.save();
      ctx.translate(w.pos.x, w.pos.y);
      ctx.rotate(w.heading);
      
      // Create a soft gradient for turbulent water effect
      const grad = ctx.createRadialGradient(-w.width/4, 0, 0, -w.width/4, 0, w.width);
      grad.addColorStop(0, `rgba(255, 255, 255, ${w.opacity})`);
      grad.addColorStop(0.5, `rgba(255, 255, 255, ${w.opacity * 0.3})`);
      grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
      
      ctx.fillStyle = grad;
      ctx.beginPath();
      // Draw a soft elongated shape for the wake
      ctx.ellipse(-w.width/2, 0, w.width, w.width/3, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });

    // Draw Ice Floes
    world.iceFloes.forEach(floe => {
      ctx.save();
      ctx.translate(floe.pos.x, floe.pos.y);
      
      ctx.beginPath();
      ctx.moveTo(floe.points[0].x, floe.points[0].y);
      floe.points.forEach(p => ctx.lineTo(p.x, p.y));
      ctx.closePath();
      
      // Ice color: almost white with a slight bluish tint
      ctx.fillStyle = '#f0f9ff'; 
      ctx.fill();
      
      // Add some detail/shading to the ice
      ctx.strokeStyle = '#e0f2fe';
      ctx.lineWidth = 1;
      ctx.stroke();
      
      // Subtle inner glow/shadow for depth
      ctx.beginPath();
      ctx.moveTo(floe.points[0].x * 0.8, floe.points[0].y * 0.8);
      floe.points.forEach(p => ctx.lineTo(p.x * 0.8, p.y * 0.8));
      ctx.closePath();
      ctx.fillStyle = 'rgba(186, 230, 253, 0.3)';
      ctx.fill();
      
      ctx.restore();
    });

    // Draw Ship (Tanker Style)
    ctx.save();
    ctx.translate(ship.pos.x, ship.pos.y);
    ctx.rotate(ship.heading);
    
    // Ship Hull Shadow
    ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 3;

    // Tanker Hull (Longer, more rectangular)
    ctx.fillStyle = '#1e293b'; // Dark hull
    ctx.beginPath();
    // Bow
    ctx.moveTo(shipWidth / 2 + 8, 0);
    ctx.lineTo(shipWidth / 2, -SHIP_HEIGHT / 2);
    // Port side
    ctx.lineTo(-shipWidth / 2, -SHIP_HEIGHT / 2);
    // Stern
    ctx.lineTo(-shipWidth / 2 - 2, -SHIP_HEIGHT / 4);
    ctx.lineTo(-shipWidth / 2 - 2, SHIP_HEIGHT / 4);
    ctx.lineTo(-shipWidth / 2, SHIP_HEIGHT / 2);
    // Starboard side
    ctx.lineTo(shipWidth / 2, SHIP_HEIGHT / 2);
    ctx.closePath();
    ctx.fill();
    
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
    
    // Hull Outline for contrast
    ctx.strokeStyle = '#64748b'; // Lighter gray for contrast
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Deck (Reddish-brown for tanker)
    ctx.fillStyle = '#451a03';
    ctx.fillRect(-shipWidth / 2 + 2, -SHIP_HEIGHT / 2 + 2, shipWidth - 2, SHIP_HEIGHT - 4);

    // Bridge / Superstructure (At the back for tankers)
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(-shipWidth / 2 + 4, -SHIP_HEIGHT / 2 + 3, shipWidth / 4, SHIP_HEIGHT - 6);
    ctx.strokeStyle = '#94a3b8';
    ctx.strokeRect(-shipWidth / 2 + 4, -SHIP_HEIGHT / 2 + 3, shipWidth / 4, SHIP_HEIGHT - 6);

    // Funnel (Chimney)
    ctx.fillStyle = '#ef4444';
    ctx.fillRect(-shipWidth / 2 + 6, -2, 4, 4);

    // Tanks / Pipes on deck
    ctx.fillStyle = '#334155';
    const tankCount = Math.floor(shipWidth / 12);
    const tankSpacing = (shipWidth * 0.6) / tankCount;
    for (let i = 0; i < tankCount; i++) {
      const tx = -shipWidth / 4 + i * tankSpacing + 4;
      ctx.fillRect(tx, -SHIP_HEIGHT / 3, tankSpacing - 4, (SHIP_HEIGHT / 3) * 2);
    }

    // Bow Thruster Indicators
    if (Math.abs(ship.bowThruster) > 0.05) {
      const power = Math.abs(ship.bowThruster);
      const side = ship.bowThruster > 0 ? 1 : -1;
      
      // Interpolate color: light blue (#93c5fd) to bright red (#ef4444)
      // Light blue: r:147, g:197, b:253
      // Bright red: r:239, g:68, b:68
      const r = Math.round(147 + (239 - 147) * power);
      const g = Math.round(197 + (68 - 197) * power);
      const b = Math.round(253 + (68 - 253) * power);
      ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;

      const arrowLength = 5 + 10 * power;
      const arrowWidth = 4;
      const baseY = side * (SHIP_HEIGHT / 2);
      const tipY = side * (SHIP_HEIGHT / 2 + arrowLength);
      
      ctx.beginPath();
      ctx.moveTo(shipWidth / 2, tipY); // Tip pointing outwards
      ctx.lineTo(shipWidth / 2 + arrowWidth, baseY); // Base corner 1
      ctx.lineTo(shipWidth / 2 - arrowWidth, baseY); // Base corner 2
      ctx.closePath();
      ctx.fill();
      
      // Optional: add a small glow
      ctx.shadowBlur = 5;
      ctx.shadowColor = `rgba(${r}, ${g}, ${b}, 0.5)`;
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    ctx.restore();

    // Draw HUD
    if (gameState === 'playing') {
      const speed = (Math.hypot(ship.velocity.x, ship.velocity.y) * 0.5).toFixed(1);
      const rudderDir = ship.rudder > 0 ? 'STBD' : ship.rudder < 0 ? 'PORT' : 'MID';
      const rudderPct = Math.abs(ship.rudder * 100).toFixed(0);
      const btDir = ship.bowThruster > 0 ? 'STBD' : ship.bowThruster < 0 ? 'PORT' : 'OFF';
      const btPct = Math.abs(ship.bowThruster * 100).toFixed(0);
      const draft = (6 + (ship.cargo / 100) * 19).toFixed(1);
      const currentDepth = getDepthAt(ship.pos, world.shallowZones).toFixed(1);

      // Reward Calculation
      const initialReward = (ship.cargo / 100) * 100000;
      const elapsedTime = (Date.now() - ship.startTime) / 1000;
      const timeFactor = Math.max(0, 1 - elapsedTime / 300);
      const fuelCost = (100 - ship.fuel) * 100; // 100€ per 1% fuel
      const currentReward = Math.max(0, initialReward * timeFactor - fuelCost);

      ctx.fillStyle = 'white';
      ctx.font = '12px "JetBrains Mono"';
      
      // Top HUD
      ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
      ctx.fillRect(15, 15, 220, 80);
      ctx.fillStyle = 'white';
      ctx.fillText(`TIME: ${Math.floor(elapsedTime / 60)}:${(elapsedTime % 60).toFixed(0).padStart(2, '0')}`, 25, 35);
      
      // Fuel Bar
      ctx.fillText(`FUEL:`, 25, 55);
      ctx.fillStyle = ship.fuel < 20 ? '#ef4444' : '#22c55e';
      ctx.fillRect(70, 45, ship.fuel * 1.5, 12);
      ctx.strokeStyle = 'white';
      ctx.strokeRect(70, 45, 150, 12);
      
      if (ship.fuel < 20) {
        ctx.fillStyle = '#ef4444';
        ctx.font = 'bold 10px "JetBrains Mono"';
        ctx.fillText('LOW FUEL', 225, 55);
      }
      
      ctx.fillStyle = '#fbbf24';
      ctx.font = 'bold 14px "JetBrains Mono"';
      ctx.fillText(`PAYOUT: ${currentReward.toLocaleString('fi-FI', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })}`, 25, 80);

      ctx.fillStyle = 'white';
      ctx.font = '12px "JetBrains Mono"';
      ctx.fillText(`SPEED: ${speed} kn`, 20, canvas.height - 125);
      ctx.fillText(`HEADING: ${((ship.heading * 180) / Math.PI % 360).toFixed(0)}°`, 20, canvas.height - 110);
      ctx.fillText(`THROTTLE: ${(ship.throttle * 100).toFixed(0)}%`, 20, canvas.height - 95);
      ctx.fillText(`RUDDER: ${rudderDir} ${rudderPct}%`, 20, canvas.height - 80);
      ctx.fillText(`BOW THRUSTER: ${btDir} ${btPct}%`, 20, canvas.height - 65);
      
      ctx.fillStyle = parseFloat(currentDepth) < parseFloat(draft) + 2 ? '#fca5a5' : '#93c5fd';
      ctx.fillText(`DRAFT: ${draft} m`, 20, canvas.height - 45);
      ctx.fillText(`DEPTH: ${currentDepth} m`, 20, canvas.height - 30);

      // Wind Indicator
      const windX = canvas.width - 80;
      const windY = canvas.height - 80;
      
      // Draw Forecast (10s ahead)
      // Simplified forecast calculation based on current targets
      const forecastDt = 10;
      const dirDiff = Math.atan2(Math.sin(wind.targetDirection - wind.direction), Math.cos(wind.targetDirection - wind.direction));
      const forecastDir = wind.direction + dirDiff * forecastDt * 0.1;
      const forecastStrength = wind.strength + (wind.targetStrength - wind.strength) * forecastDt * 0.1;

      // Forecast arrow (faded)
      ctx.save();
      ctx.translate(windX, windY);
      ctx.rotate(forecastDir);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-15, 0);
      ctx.lineTo(15, 0);
      ctx.lineTo(10, -5);
      ctx.moveTo(15, 0);
      ctx.lineTo(10, 5);
      ctx.stroke();
      ctx.restore();

      // Current wind arrow
      ctx.save();
      ctx.translate(windX, windY);
      ctx.rotate(wind.direction);
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(-20, 0);
      ctx.lineTo(20, 0);
      ctx.lineTo(12, -8);
      ctx.moveTo(20, 0);
      ctx.lineTo(12, 8);
      ctx.stroke();
      ctx.restore();

      ctx.fillStyle = 'white';
      ctx.textAlign = 'center';
      ctx.fillText('WIND', windX, windY - 35);
      ctx.font = '10px "JetBrains Mono"';
      ctx.fillText(`${(wind.strength * 25).toFixed(1)} kn`, windX, windY + 35);
      ctx.fillText('10s FORECAST', windX, windY + 50);
      ctx.textAlign = 'left';
    }

  }, [world, ship, gameState]);

  const animate = useCallback((time: number) => {
    const dt = 1 / 60; // Fixed timestep for simplicity
    updatePhysics(dt);
    draw();
    requestRef.current = requestAnimationFrame(animate);
  }, [updatePhysics, draw]);

  useEffect(() => {
    requestRef.current = requestAnimationFrame(animate);
    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, [animate]);

  return (
    <div className="relative w-full h-screen overflow-hidden bg-[#0a0a0a]">
      <canvas
        ref={canvasRef}
        width={window.innerWidth}
        height={window.innerHeight}
        className="block"
      />

      <AnimatePresence>
        {gameState === 'playing' && (
          <motion.div 
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="absolute top-6 left-1/2 -translate-x-1/2 z-40"
          >
            <button
              onClick={initGame}
              className="px-4 py-2 bg-white/10 hover:bg-white/20 backdrop-blur-md border border-white/10 text-white font-mono text-xs rounded-lg transition-colors flex items-center gap-2 pointer-events-auto"
            >
              <RotateCcw size={14} /> RESET VOYAGE
            </button>
          </motion.div>
        )}

        {gameState === 'menu' && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 flex items-center justify-center bg-black/80 backdrop-blur-sm z-50"
          >
            <div className="max-w-md w-full p-8 bg-[#151619] border border-white/10 rounded-2xl shadow-2xl">
              <div className="flex items-center gap-3 mb-6">
                <Anchor className="text-blue-500 w-8 h-8" />
                <h1 className="text-3xl font-extrabold tracking-tighter uppercase">NauticSim</h1>
              </div>
              
              <p className="text-gray-400 mb-8 font-mono text-sm leading-relaxed">
                Precision cargo navigation simulation. Manage momentum, avoid obstacles, and dock safely.
              </p>

              <div className="space-y-6 mb-8">
                <div>
                  <div className="flex justify-between items-center mb-2">
                    <label className="text-xs font-bold uppercase tracking-widest text-gray-500 flex items-center gap-2">
                      <Weight size={14} /> Cargo Load
                    </label>
                    <span className="font-mono text-blue-400">{cargo} tons</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={cargo}
                    onChange={(e) => setCargo(parseInt(e.target.value))}
                    className="w-full h-2 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-blue-500"
                  />
                  <div className="flex justify-between mt-2 text-[10px] font-mono text-gray-600">
                    <span>LIGHT / AGILE</span>
                    <span>HEAVY / SLUGGISH</span>
                  </div>
                </div>
              </div>

              <button
                onClick={initGame}
                className="w-full py-4 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl transition-all flex items-center justify-center gap-2 group"
              >
                <Play size={18} className="group-hover:scale-110 transition-transform" />
                COMMENCE VOYAGE
              </button>
            </div>
          </motion.div>
        )}

        {(gameState === 'won' || gameState === 'crashed') && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-md z-50"
          >
            <div className="p-10 bg-[#151619] border border-white/10 rounded-3xl shadow-2xl text-center max-w-sm">
              {gameState === 'won' ? (
                <>
                  <div className="w-20 h-20 bg-green-500/20 rounded-full flex items-center justify-center mx-auto mb-6">
                    <CheckCircle2 className="text-green-500 w-12 h-12" />
                  </div>
                  <h2 className="text-3xl font-black mb-2 tracking-tighter">MISSION SUCCESS</h2>
                  <p className="text-gray-400 mb-4 font-mono text-sm">Cargo delivered safely to destination port.</p>
                  
                  <div className="bg-black/40 border border-white/5 p-4 rounded-xl mb-6 space-y-2 text-left font-mono text-xs">
                    <div className="flex justify-between">
                      <span className="text-gray-500">INITIAL REWARD</span>
                      <span className="text-white">{finalPayout.initial.toLocaleString('fi-FI', { maximumFractionDigits: 0 })} €</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">TIME PENALTY</span>
                      <span className="text-red-400">-{finalPayout.timePenalty.toLocaleString('fi-FI', { maximumFractionDigits: 0 })} €</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">FUEL COSTS</span>
                      <span className="text-red-400">-{finalPayout.fuelCost.toLocaleString('fi-FI', { maximumFractionDigits: 0 })} €</span>
                    </div>
                    <div className="h-px bg-white/10 my-2" />
                    <div className="flex justify-between text-sm font-bold">
                      <span className="text-blue-400">FINAL PAYOUT</span>
                      <span className="text-green-400">{finalPayout.total.toLocaleString('fi-FI', { maximumFractionDigits: 0 })} €</span>
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div className="w-20 h-20 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-6">
                    <AlertTriangle className="text-red-500 w-12 h-12" />
                  </div>
                  <h2 className="text-3xl font-black mb-2 tracking-tighter">VESSEL LOST</h2>
                  <p className="text-gray-400 mb-8 font-mono text-sm">Mission failed. Vessel is immobilized or destroyed.</p>
                </>
              )}
              
              <button
                onClick={() => setGameState('menu')}
                className="w-full py-4 bg-white text-black font-bold rounded-xl hover:bg-gray-200 transition-colors flex items-center justify-center gap-2"
              >
                <RotateCcw size={18} /> RETURN TO BASE
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Controls Overlay */}
      <div className="absolute top-6 right-6 flex flex-col gap-4 items-end pointer-events-none">
        <div className="bg-black/40 backdrop-blur-md p-4 border border-white/5 rounded-xl font-mono text-[10px] text-gray-400 space-y-2">
          <div className="flex justify-between gap-8">
            <span>THROTTLE</span>
            <span className="text-white">W / S</span>
          </div>
          <div className="flex justify-between gap-8">
            <span>STEER</span>
            <span className="text-white">A / D</span>
          </div>
          <div className="flex justify-between gap-8">
            <span>BOW THRUST</span>
            <span className="text-white">Q / E</span>
          </div>
          <div className="flex justify-between gap-8">
            <span>DOCKING</span>
            <span className="text-white">SPEED &lt; 2</span>
          </div>
        </div>
      </div>
    </div>
  );
}
