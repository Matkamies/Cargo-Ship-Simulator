export interface Vector2D {
  x: number;
  y: number;
}

export interface ShipState {
  pos: Vector2D;
  velocity: Vector2D;
  heading: number; // in radians
  angularVelocity: number;
  throttle: number; // -1 to 1
  rudder: number; // -1 to 1
  bowThruster: number; // -1 to 1 (left to right)
  cargo: number; // 0 to 100
  path: Vector2D[];
  wake: { pos: Vector2D; heading: number; opacity: number; width: number }[];
  fuel: number; // 0 to 100
  startTime: number;
}

export interface Island {
  x: number;
  y: number;
  radius: number;
  points: Vector2D[];
}

export interface ShallowZone {
  x: number;
  y: number;
  radius: number;
  depth: number; // in meters
  points?: Vector2D[]; // Optional points for irregular shapes
}

export interface Port {
  x: number;
  y: number;
  width: number;
  height: number;
  isDestination: boolean;
}

export interface WindState {
  direction: number; // in radians
  strength: number; // 0 to 1
  targetDirection: number;
  targetStrength: number;
}

export interface IceFloe {
  pos: Vector2D;
  velocity: Vector2D;
  radius: number;
  points: Vector2D[];
  stuck: boolean;
  lastSplitTime: number;
  windSensitivity: number;
}

export interface GameConfig {
  width: number;
  height: number;
  cargoWeight: number;
}
