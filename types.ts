
export interface Vector2D {
  x: number;
  y: number;
}

export enum GameState {
  START = 'START',
  PLAYING = 'PLAYING',
  GAMEOVER = 'GAMEOVER'
}

export enum PowerUpType {
  SHIELD = 'SHIELD',
  BOOST = 'BOOST',
  MULTIPLIER = 'MULTIPLIER'
}

export interface Environment {
  name: string;
  primaryColor: string;
  secondaryColor: string;
  description: string;
  atmosphere: string;
}

export interface Obstacle {
  id: string;
  x: number;
  y: number;
  baseY: number;
  width: number;
  height: number;
  type: 'spike' | 'wall' | 'drone' | 'mine' | 'laser' | 'saw' | 'stomp' | 'missile';
  speedMultiplier: number;
  state?: any; 
}

export interface Collectible {
  id: string;
  x: number;
  y: number;
  size: number;
  collected: boolean;
}

export interface PowerUp {
  id: string;
  x: number;
  y: number;
  size: number;
  type: PowerUpType;
  collected: boolean;
}

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  color: string;
  type?: 'spark' | 'heart';
}

export interface ChatComment {
  id: string;
  username: string;
  text: string;
  color: string;
}

export type SocialEvent = 'NEAR_MISS' | 'COLLECT' | 'POWERUP' | 'BIOME_SHIFT' | 'LEVEL_UP';
