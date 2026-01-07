
import React, { useRef, useEffect, useState, useCallback } from 'react';
import { GameState, Vector2D, Obstacle, Particle, Environment, Collectible, PowerUp, PowerUpType, SocialEvent } from '../types';
import * as audio from '../services/audioService';

interface GameCanvasProps {
  gameState: GameState;
  onGameOver: (score: number) => void;
  environment: Environment;
  onScoreUpdate: (score: number) => void;
  onSocialEvent: (event: SocialEvent) => void;
}

interface BgDecor {
  x: number;
  y: number;
  size: number;
  colorType: 'primary' | 'secondary';
  parallax: number;
  opacity: number;
  type: 'circle' | 'rect';
}

interface ActivePowerUpState {
  type: PowerUpType;
  timeLeft: number;
  percent: number;
}

const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 400;
const GROUND_Y = 320;
const GRAVITY = 0.8;
const JUMP_FORCE = -15;
const PLAYER_X = 100;
const PLAYER_SIZE = 30;
const PLAYER_SPEED = 5;
const POWERUP_DURATION = 8000; 
const NEAR_MISS_THRESHOLD = 25;
const INVINCIBILITY_DURATION = 2000;

const ATMOSPHERE_PROFILES: Record<string, { freq: number; amp: number; squash: number; lean: number; bob: number }> = {
  electric: { freq: 18, amp: 3, squash: 0.12, lean: 0.25, bob: 0.6 }, 
  heavy: { freq: 7, amp: 8, squash: 0.35, lean: 0.05, bob: 1.4 },   
  cold: { freq: 11, amp: 1.5, squash: 0.04, lean: 0.18, bob: 0.3 },    
  ethereal: { freq: 4, amp: 12, squash: 0.22, lean: 0.12, bob: 2.0 }, 
  default: { freq: 12, amp: 4, squash: 0.12, lean: 0.16, bob: 1.0 }
};

export const GameCanvas: React.FC<GameCanvasProps> = ({ gameState, onGameOver, environment, onScoreUpdate, onSocialEvent }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const requestRef = useRef<number | undefined>(undefined);
  const deathTimeoutRef = useRef<number | null>(null);
  
  const [activeHudPowerUps, setActiveHudPowerUps] = useState<ActivePowerUpState[]>([]);
  const [hasMultiplier, setHasMultiplier] = useState(false);
  const [lastSocialMsg, setLastSocialMsg] = useState<{text: string, time: number, color?: string} | null>(null);
  
  const keysPressed = useRef<Record<string, boolean>>({});
  const playerPos = useRef<Vector2D>({ x: PLAYER_X, y: GROUND_Y - PLAYER_SIZE });
  const playerVel = useRef<Vector2D>({ x: 0, y: 0 });
  const isJumping = useRef<boolean>(false);
  const scoreRef = useRef<number>(0);
  const lastLevelRef = useRef<number>(1);
  const lastXDir = useRef<number>(0); 
  const isDying = useRef<boolean>(false);
  const invincibleUntil = useRef<number>(0);
  const timeScale = useRef<number>(1.0);
  const dashTrails = useRef<Vector2D[]>([]);
  const activePowerUps = useRef<Map<PowerUpType, number>>(new Map());
  const obstacles = useRef<Obstacle[]>([]);
  const collectibles = useRef<Collectible[]>([]);
  const powerUps = useRef<PowerUp[]>([]);
  const particles = useRef<Particle[]>([]);
  const backgroundOffset = useRef<number>(0);
  const bgDecorations = useRef<BgDecor[]>([]);
  const nearMissedObstacles = useRef<Set<string>>(new Set());
  
  const shakeTime = useRef<number>(0);
  const shakeOffset = useRef<Vector2D>({ x: 0, y: 0 });

  useEffect(() => {
    const decors: BgDecor[] = [];
    for (let i = 0; i < 20; i++) {
      decors.push({
        x: Math.random() * CANVAS_WIDTH * 2,
        y: Math.random() * (GROUND_Y - 50),
        size: 10 + Math.random() * 40,
        colorType: Math.random() > 0.5 ? 'primary' : 'secondary',
        parallax: 0.1 + Math.random() * 0.3, 
        opacity: 0.05 + Math.random() * 0.15,
        type: Math.random() > 0.7 ? 'rect' : 'circle'
      });
    }
    bgDecorations.current = decors;
  }, []);

  const resetGame = useCallback(() => {
    if (deathTimeoutRef.current) {
      window.clearTimeout(deathTimeoutRef.current);
      deathTimeoutRef.current = null;
    }
    scoreRef.current = 0;
    lastLevelRef.current = 1;
    obstacles.current = [];
    collectibles.current = [];
    powerUps.current = [];
    particles.current = [];
    dashTrails.current = [];
    nearMissedObstacles.current.clear();
    activePowerUps.current.clear();
    setActiveHudPowerUps([]);
    playerPos.current = { x: PLAYER_X, y: GROUND_Y - PLAYER_SIZE };
    playerVel.current = { x: 0, y: 0 };
    lastXDir.current = 0;
    isDying.current = false;
    invincibleUntil.current = 0;
    timeScale.current = 1.0;
    setHasMultiplier(false);
    setLastSocialMsg(null);
    shakeTime.current = 0;
    shakeOffset.current = { x: 0, y: 0 };
  }, []);

  useEffect(() => {
    if (gameState === GameState.START) resetGame();
    else if (gameState === GameState.PLAYING) {
      if (isDying.current || (scoreRef.current === 0 && obstacles.current.length > 0)) {
        resetGame();
      }
    }
  }, [gameState, resetGame]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      keysPressed.current[e.code] = true;
      if (gameState !== GameState.PLAYING || isDying.current) return;
      if ((e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') && !isJumping.current) {
        playerVel.current.y = JUMP_FORCE;
        isJumping.current = true;
        audio.playJumpSound();
        createJumpParticles();
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => keysPressed.current[e.code] = false;
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [gameState]);

  const createJumpParticles = () => {
    for (let i = 0; i < 20; i++) {
      particles.current.push({
        x: playerPos.current.x + PLAYER_SIZE / 2,
        y: playerPos.current.y + PLAYER_SIZE,
        vx: (Math.random() - 0.5) * 8,
        vy: (Math.random() * 4) + 1,
        life: 0.5 + Math.random() * 0.5,
        color: environment.secondaryColor
      });
    }
  };

  const createLikeParticles = (x: number, y: number) => {
    for (let i = 0; i < 5; i++) {
      particles.current.push({
        x, y,
        vx: (Math.random() - 0.5) * 4,
        vy: -Math.random() * 6 - 2,
        life: 1.0,
        color: '#ff0055',
        type: 'heart'
      });
    }
  };

  const createCollisionBurst = (x: number, y: number, colors: string[], count: number, force: number = 25) => {
    for (let i = 0; i < count; i++) {
      particles.current.push({
        x, y,
        vx: (Math.random() - 0.5) * force,
        vy: (Math.random() - 0.5) * force,
        life: 0.8 + Math.random() * 1.5,
        color: colors[Math.floor(Math.random() * colors.length)]
      });
    }
  };

  const spawnCollectible = () => {
    collectibles.current.push({
      id: Math.random().toString(36).substr(2, 9),
      x: CANVAS_WIDTH + 200,
      y: GROUND_Y - 50 - Math.random() * 150,
      size: 20,
      collected: false
    });
  };

  const spawnPowerUp = () => {
    const types: PowerUpType[] = [PowerUpType.SHIELD, PowerUpType.BOOST, PowerUpType.MULTIPLIER];
    const type = types[Math.floor(Math.random() * types.length)];
    powerUps.current.push({
      id: Math.random().toString(36).substr(2, 9),
      x: CANVAS_WIDTH + 200,
      y: GROUND_Y - 100 - Math.random() * 100,
      size: 30,
      type,
      collected: false
    });
  };

  const spawnObstacle = () => {
    const types: ('spike' | 'wall' | 'drone' | 'mine' | 'laser' | 'saw' | 'stomp' | 'missile')[] = 
      ['spike', 'wall', 'drone', 'mine', 'laser', 'saw', 'stomp', 'missile'];
    const type = types[Math.floor(Math.random() * types.length)];
    let height = 30, width = 30, y = GROUND_Y - height, state = null;

    if (type === 'wall') { height = 60; y = GROUND_Y - height; }
    else if (type === 'drone') { y = GROUND_Y - 80 - Math.random() * 50; }
    else if (type === 'mine') { width = 25; height = 25; y = GROUND_Y - 100 - Math.random() * 100; state = { phase: Math.random() * Math.PI * 2 }; }
    else if (type === 'laser') { width = 20; height = GROUND_Y; y = 0; state = { timer: 0, active: false }; }
    else if (type === 'saw') { width = 40; height = 40; y = GROUND_Y - height; state = { rotation: 0 }; }
    else if (type === 'stomp') { width = 60; height = 80; y = -height; state = { stage: 'waiting', timer: 1000 + Math.random() * 1000, impactSoundPlayed: false }; }
    else if (type === 'missile') { 
      width = 40; height = 20; y = playerPos.current.y; state = { speed: 8 + Math.random() * 5 }; 
      audio.playMissileLaunchSound();
    }

    obstacles.current.push({
      id: Math.random().toString(36).substr(2, 9),
      x: CANVAS_WIDTH + 150, y, baseY: y, width, height, type,
      speedMultiplier: 1 + (scoreRef.current / 1000),
      state
    });

    const rand = Math.random();
    if (rand > 0.85) spawnPowerUp();
    else if (rand > 0.7) spawnCollectible();
  };

  const triggerDeathSequence = (impactX: number, impactY: number) => {
    if (isDying.current) return;
    isDying.current = true;
    timeScale.current = 0.15;
    audio.playGameOverSound();
    
    createCollisionBurst(
        impactX, 
        impactY, 
        [environment.primaryColor, environment.secondaryColor, '#ffffff', '#ff0000', '#ff8800'], 
        100, 
        40
    );
    
    shakeTime.current = 200; 
    
    const tid = window.setTimeout(() => { if (isDying.current) onGameOver(Math.floor(scoreRef.current)); }, 1500);
    deathTimeoutRef.current = tid;
  };

  const update = useCallback(() => {
    if (gameState !== GameState.PLAYING) return;
    const dt = timeScale.current;
    const now = Date.now();
    
    if (shakeTime.current > 0) {
        shakeTime.current -= 16 * dt; 
        shakeOffset.current = {
            x: (Math.random() - 0.5) * 15,
            y: (Math.random() - 0.5) * 15
        };
    } else {
        shakeOffset.current = { x: 0, y: 0 };
    }

    const isMultActive = activePowerUps.current.has(PowerUpType.MULTIPLIER);
    setHasMultiplier(isMultActive);
    
    const hudUpdates: ActivePowerUpState[] = [];
    for (const [type, expiry] of activePowerUps.current.entries()) {
      if (now > expiry) activePowerUps.current.delete(type);
      else {
        const timeLeft = expiry - now;
        hudUpdates.push({ type, timeLeft, percent: (timeLeft / POWERUP_DURATION) * 100 });
      }
    }
    setActiveHudPowerUps(hudUpdates);

    let currentSpeed = PLAYER_SPEED;
    if (activePowerUps.current.has(PowerUpType.BOOST)) currentSpeed *= 1.6;

    let currentDir = 0;
    if (!isDying.current) {
        if (keysPressed.current['ArrowLeft'] || keysPressed.current['KeyA']) { currentDir = -1; }
        if (keysPressed.current['ArrowRight'] || keysPressed.current['KeyD']) { currentDir = 1; }

        const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
        for (const gp of gamepads) {
          if (gp) {
            if (gp.axes[0] < -0.3) currentDir = -1;
            else if (gp.axes[0] > 0.3) currentDir = 1;
            if (gp.buttons[14]?.pressed) currentDir = -1;
            if (gp.buttons[15]?.pressed) currentDir = 1;
            if (!isJumping.current && (gp.buttons[0]?.pressed || gp.buttons[1]?.pressed || gp.buttons[2]?.pressed)) {
              playerVel.current.y = JUMP_FORCE;
              isJumping.current = true;
              audio.playJumpSound();
              createJumpParticles();
            }
          }
        }

        playerPos.current.x += currentDir * currentSpeed * dt;
        lastXDir.current = currentDir;
    }

    if (activePowerUps.current.has(PowerUpType.BOOST)) {
        dashTrails.current.unshift({ ...playerPos.current });
        if (dashTrails.current.length > 12) dashTrails.current.pop();
    } else { if (dashTrails.current.length > 0) dashTrails.current.pop(); }

    playerPos.current.x = Math.max(0, Math.min(playerPos.current.x, CANVAS_WIDTH - PLAYER_SIZE));
    playerVel.current.y += GRAVITY * dt;
    playerPos.current.y += playerVel.current.y * dt;

    if (playerPos.current.y > GROUND_Y - PLAYER_SIZE) {
      playerPos.current.y = GROUND_Y - PLAYER_SIZE;
      playerVel.current.y = 0;
      isJumping.current = false;
    }

    const gameSpeed = (6 + (scoreRef.current / 1200)) * dt;
    if (!isDying.current) {
        scoreRef.current += (gameSpeed / 8) * (isMultActive ? 2.5 : 1);
        
        const currentLevel = Math.floor(scoreRef.current / 1000) + 1;
        if (currentLevel > lastLevelRef.current) {
            lastLevelRef.current = currentLevel;
            onSocialEvent('LEVEL_UP');
            setLastSocialMsg({ text: `LEVEL UP: ${currentLevel}`, time: now, color: '#00ff00' });
            invincibleUntil.current = now + INVINCIBILITY_DURATION;
            audio.playLevelUpSound();
        }
    }

    obstacles.current.forEach(obs => {
      if (obs.type !== 'missile') obs.x -= gameSpeed;
      else obs.x -= (gameSpeed + obs.state.speed * dt);

      if (obs.type === 'drone') obs.y = obs.baseY + Math.sin(now / 300 + obs.x / 100) * 12;
      else if (obs.type === 'mine') {
        const time = now / 400 + obs.state.phase;
        obs.y = obs.baseY + Math.sin(time) * 40;
        obs.x += Math.cos(time * 1.5) * 2;
      } else if (obs.type === 'laser') {
        obs.state.timer += 16 * dt;
        if (obs.state.timer > 2000) { 
          obs.state.timer = 0; 
          obs.state.active = !obs.state.active; 
          if (obs.state.active) audio.playLaserOnSound();
        }
      } else if (obs.type === 'saw') obs.state.rotation += 0.2 * dt;
      else if (obs.type === 'stomp') {
        const s = obs.state;
        if (s.stage === 'waiting') { 
          s.timer -= 16 * dt; 
          if (s.timer <= 0) s.stage = 'dropping'; 
        } else if (s.stage === 'dropping') { 
          obs.y += 20 * dt; 
          if (obs.y >= GROUND_Y - obs.height) { 
            obs.y = GROUND_Y - obs.height; 
            if (!s.impactSoundPlayed) {
              audio.playStompSound();
              createCollisionBurst(obs.x + obs.width/2, GROUND_Y, [environment.secondaryColor, '#ffffff'], 15);
              s.impactSoundPlayed = true;
            }
            s.stage = 'rising'; 
            s.timer = 500; 
          } 
        } else if (s.stage === 'rising') { 
          s.timer -= 16 * dt; 
          if (s.timer <= 0) { 
            obs.y -= 3 * dt; 
            if (obs.y <= -obs.height) { 
              obs.y = -obs.height; 
              s.stage = 'waiting'; 
              s.timer = 1500 + Math.random() * 2000;
              s.impactSoundPlayed = false;
            } 
          } 
        }
      }

      if (!isDying.current && !nearMissedObstacles.current.has(obs.id)) {
        const dx = (playerPos.current.x + PLAYER_SIZE/2) - (obs.x + obs.width/2);
        const dy = (playerPos.current.y + PLAYER_SIZE/2) - (obs.y + obs.height/2);
        const dist = Math.sqrt(dx*dx + dy*dy);
        if (dist < PLAYER_SIZE + NEAR_MISS_THRESHOLD) {
          nearMissedObstacles.current.add(obs.id);
          onSocialEvent('NEAR_MISS');
          setLastSocialMsg({ text: 'NEAR MISS! +500 CLOUT', time: now });
          scoreRef.current += 500;
        }
      }
    });

    collectibles.current.forEach(col => col.x -= gameSpeed);
    powerUps.current.forEach(pup => pup.x -= gameSpeed);
    obstacles.current = obstacles.current.filter(obs => obs.x + obs.width > -50);
    onScoreUpdate(Math.floor(scoreRef.current));
    collectibles.current = collectibles.current.filter(col => col.x + col.size > -50 && !col.collected);
    powerUps.current = powerUps.current.filter(pup => pup.x + pup.size > -50 && !pup.collected);

    if (!isDying.current && (obstacles.current.length === 0 || 
        (obstacles.current[obstacles.current.length - 1].x < CANVAS_WIDTH - (250 - Math.min(scoreRef.current / 30, 150))))) spawnObstacle();

    particles.current.forEach(p => {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= 0.02 * dt;
    });
    particles.current = particles.current.filter(p => p.life > 0);

    if (!isDying.current) {
        for (const pup of powerUps.current) {
            if (!pup.collected && playerPos.current.x < pup.x + pup.size && playerPos.current.x + PLAYER_SIZE > pup.x && playerPos.current.y < pup.y + pup.size && playerPos.current.y + PLAYER_SIZE > pup.y) {
                pup.collected = true;
                activePowerUps.current.set(pup.type, now + POWERUP_DURATION);
                
                // Specialized PowerUp Sounds
                if (pup.type === PowerUpType.SHIELD) audio.playShieldActivateSound();
                else if (pup.type === PowerUpType.BOOST) audio.playBoostActivateSound();
                else if (pup.type === PowerUpType.MULTIPLIER) audio.playMultiplierActivateSound();
                else audio.playPowerUpSound();

                onSocialEvent('POWERUP');
                createCollisionBurst(pup.x + pup.size/2, pup.y + pup.size/2, ['#ffffff'], 15);
            }
        }
        for (const col of collectibles.current) {
            if (!col.collected && playerPos.current.x < col.x + col.size && playerPos.current.x + PLAYER_SIZE > col.x && playerPos.current.y < col.y + col.size && playerPos.current.y + PLAYER_SIZE > col.y) {
                col.collected = true;
                scoreRef.current += isMultActive ? 300 : 100;
                audio.playCollectSound();
                onSocialEvent('COLLECT');
                createLikeParticles(col.x + col.size/2, col.y + col.size/2);
            }
        }
        
        const isInvincible = now < invincibleUntil.current;
        if (!isInvincible) {
          for (const obs of obstacles.current) {
            const m = 5;
            const hit = (obs.type !== 'laser' && playerPos.current.x + m < obs.x + obs.width - m && playerPos.current.x + PLAYER_SIZE - m > obs.x + m && playerPos.current.y + m < obs.y + obs.height - m && playerPos.current.y + PLAYER_SIZE - m > obs.y + m)
                      || (obs.type === 'laser' && obs.state.active && playerPos.current.x + PLAYER_SIZE > obs.x + 5 && playerPos.current.x < obs.x + obs.width - 5);
            if (hit) {
              if (activePowerUps.current.has(PowerUpType.SHIELD)) {
                  activePowerUps.current.delete(PowerUpType.SHIELD);
                  audio.playShieldBreakSound();
                  invincibleUntil.current = now + 1000; 
                  if (obs.type !== 'laser') obs.x = -1000; 
                  createCollisionBurst(playerPos.current.x, playerPos.current.y, ['#00ffff'], 30);
              } else triggerDeathSequence(playerPos.current.x, playerPos.current.y);
            }
          }
        }
    }
    backgroundOffset.current -= gameSpeed * 0.5;
  }, [gameState, environment, onGameOver, onScoreUpdate, onSocialEvent]);

  const drawPlayer = (ctx: CanvasRenderingContext2D) => {
    const now = Date.now(), x = playerPos.current.x, y = playerPos.current.y, vy = playerVel.current.y, dir = lastXDir.current;
    let scaleX = 1, scaleY = 1, rotation = 0, offsetY = 0;
    const profile = ATMOSPHERE_PROFILES[environment.atmosphere] || ATMOSPHERE_PROFILES.default;
    const runCycle = (now * profile.freq * (1 + scoreRef.current / 4000)) / 1000;

    const isInvincible = now < invincibleUntil.current;
    
    if (isInvincible || isDying.current) {
      if (Math.floor(now / 100) % 2 === 0) {
        ctx.globalAlpha = 0.4;
      }
    }

    if (isDying.current) { 
      rotation = now / 100; 
      scaleX = Math.max(0, 1 - (now % 1500) / 1500); 
      scaleY = scaleX; 
    }
    else if (isJumping.current) { 
      const s = Math.min(Math.abs(vy) * 0.02, 0.4); 
      scaleY = 1 + s; 
      scaleX = 1 - s * 0.5; 
      rotation = (vy * 0.02) * (dir === 0 ? 1 : dir); 
    }
    else if (dir !== 0) { 
      const stepPhase = (runCycle % 1) * Math.PI * 2;
      const stepWave = Math.sin(stepPhase);
      const impactWave = Math.max(0, Math.sin(stepPhase + Math.PI/2)); 
      
      offsetY = impactWave * -profile.amp * profile.bob;
      const sf = stepWave * profile.squash;
      scaleY = 1 + sf;
      scaleX = 1 - sf * 0.6;
      const stepTilt = Math.sin(stepPhase) * 0.1;
      rotation = (dir * profile.lean) + stepTilt;

      const horizontalSway = Math.sin(stepPhase / 2) * 2 * dir;
      ctx.save();
      ctx.translate(horizontalSway, 0);

      if (environment.atmosphere === 'ethereal' || environment.atmosphere === 'electric') {
        ctx.save();
        ctx.globalAlpha = 0.15;
        ctx.fillStyle = environment.primaryColor;
        for (let i = 1; i <= 3; i++) {
          const lag = i * 4;
          ctx.fillRect(-PLAYER_SIZE/2 - lag * dir, -PLAYER_SIZE/2 + (Math.sin(stepPhase - i * 0.5) * 2), PLAYER_SIZE, PLAYER_SIZE);
        }
        ctx.restore();
      }
    } else { 
      const breathe = Math.sin(now / 500) * 0.04; 
      scaleY = 1 + breathe; 
      scaleX = 1 - breathe * 0.3; 
      offsetY = Math.sin(now / 1000) * 2.5; 
    }

    ctx.save();
    ctx.translate(x + PLAYER_SIZE / 2, y + PLAYER_SIZE / 2 + offsetY); 
    ctx.rotate(rotation); 
    ctx.scale(scaleX, scaleY);
    
    ctx.fillStyle = isDying.current ? '#ff0000' : '#ffffff'; 
    ctx.shadowBlur = isDying.current ? 30 : (isInvincible ? 25 : 15); 
    ctx.shadowColor = isDying.current ? '#ff0000' : (isInvincible ? '#ffffff' : '#ffffff');
    ctx.fillRect(-PLAYER_SIZE / 2, -PLAYER_SIZE / 2, PLAYER_SIZE, PLAYER_SIZE);
    
    if (!isDying.current) {
        const coreSizePulse = Math.sin(now / 200) * 2;
        ctx.fillStyle = environment.primaryColor; 
        ctx.shadowBlur = 10; 
        ctx.shadowColor = environment.primaryColor;
        ctx.fillRect(-(10 + coreSizePulse) / 2, -(10 + coreSizePulse) / 2, 10 + coreSizePulse, 10 + coreSizePulse);
        
        ctx.fillStyle = '#000000';
        const eyeHeight = 4;
        const eyeWidth = PLAYER_SIZE - 10;
        const eyeOffset = (dir !== 0 ? dir * 3 : 0);
        ctx.fillRect(-PLAYER_SIZE/2 + 5 + eyeOffset, -PLAYER_SIZE/2 + 6, eyeWidth, eyeHeight);
        
        ctx.strokeStyle = environment.secondaryColor; 
        ctx.lineWidth = 1.5; 
        ctx.strokeRect(-PLAYER_SIZE / 2 - 2, -PLAYER_SIZE / 2 - 2, PLAYER_SIZE + 4, PLAYER_SIZE + 4);
    }
    ctx.restore();
    if (dir !== 0) ctx.restore(); 
    ctx.globalAlpha = 1.0;
    ctx.shadowBlur = 0;
  };

  const draw = useCallback((ctx: CanvasRenderingContext2D) => {
    ctx.save();
    ctx.translate(shakeOffset.current.x, shakeOffset.current.y);
    
    ctx.clearRect(-20, -20, CANVAS_WIDTH + 40, CANVAS_HEIGHT + 40); 
    const bgGrad = ctx.createLinearGradient(0, 0, 0, CANVAS_HEIGHT);
    bgGrad.addColorStop(0, '#020617'); bgGrad.addColorStop(1, '#0f172a');
    ctx.fillStyle = bgGrad; ctx.fillRect(-20, -20, CANVAS_WIDTH + 40, CANVAS_HEIGHT + 40);

    bgDecorations.current.forEach(decor => {
      const color = decor.colorType === 'primary' ? environment.primaryColor : environment.secondaryColor;
      let x = (decor.x + backgroundOffset.current * decor.parallax) % (CANVAS_WIDTH * 1.5);
      if (x < -decor.size) x += CANVAS_WIDTH * 1.5;
      ctx.globalAlpha = decor.opacity; ctx.fillStyle = color;
      if (decor.type === 'circle') { ctx.beginPath(); ctx.arc(x, decor.y, decor.size, 0, Math.PI * 2); ctx.fill(); }
      else ctx.fillRect(x, decor.y, decor.size, decor.size);
      ctx.globalAlpha = 1.0;
    });

    ctx.strokeStyle = `${environment.primaryColor}22`; ctx.lineWidth = 1;
    const gridX = backgroundOffset.current % 40;
    for (let x = gridX; x < CANVAS_WIDTH + 40; x += 40) { ctx.beginPath(); ctx.moveTo(x, -20); ctx.lineTo(x, CANVAS_HEIGHT + 20); ctx.stroke(); }
    for (let y = 0; y < CANVAS_HEIGHT; y += 40) { ctx.beginPath(); ctx.moveTo(-20, y); ctx.lineTo(CANVAS_WIDTH + 20, y); ctx.stroke(); }

    ctx.fillStyle = environment.primaryColor; ctx.fillRect(0, GROUND_Y, CANVAS_WIDTH, 4);
    ctx.shadowBlur = 15; ctx.shadowColor = environment.primaryColor;
    ctx.fillRect(0, GROUND_Y, CANVAS_WIDTH, 2); ctx.shadowBlur = 0;

    particles.current.forEach(p => {
      ctx.globalAlpha = Math.max(0, p.life); ctx.fillStyle = p.color;
      if (p.type === 'heart') {
        ctx.font = '16px serif'; ctx.fillText('❤️', p.x, p.y);
      } else {
        ctx.beginPath(); ctx.arc(p.x, p.y, 1.5 + p.life * 2.5, 0, Math.PI * 2); ctx.fill();
      }
    });
    ctx.globalAlpha = 1.0;

    collectibles.current.forEach(col => {
        if (!col.collected) {
            ctx.fillStyle = '#ffffff'; ctx.shadowBlur = 15; ctx.shadowColor = environment.primaryColor;
            ctx.beginPath(); ctx.moveTo(col.x + col.size/2, col.y); ctx.lineTo(col.x + col.size, col.y + col.size/2); ctx.lineTo(col.x + col.size/2, col.y + col.size); ctx.lineTo(col.x, col.y + col.size/2); ctx.closePath(); ctx.fill(); ctx.shadowBlur = 0;
        }
    });

    powerUps.current.forEach(pup => {
        if (!pup.collected) {
            let color = '#ffffff', icon = 'P';
            if (pup.type === PowerUpType.SHIELD) { color = '#00ffff'; icon = 'S'; }
            else if (pup.type === PowerUpType.BOOST) { color = '#ffff00'; icon = 'B'; }
            else if (pup.type === PowerUpType.MULTIPLIER) { color = '#ff00ff'; icon = 'X'; }
            ctx.fillStyle = color; ctx.shadowBlur = 20; ctx.shadowColor = color;
            ctx.beginPath(); ctx.arc(pup.x + pup.size/2, pup.y + pup.size/2, pup.size/2, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#000000'; ctx.font = 'bold 14px Orbitron'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText(icon, pup.x + pup.size/2, pup.y + pup.size/2); ctx.shadowBlur = 0;
        }
    });

    if (dashTrails.current.length > 0) {
        dashTrails.current.forEach((pos, i) => {
            const ratio = 1 - (i / dashTrails.current.length);
            ctx.globalAlpha = ratio * 0.4; ctx.fillStyle = environment.primaryColor;
            ctx.fillRect(pos.x, pos.y, PLAYER_SIZE, PLAYER_SIZE);
        });
        ctx.globalAlpha = 1.0;
    }

    drawPlayer(ctx);

    if (!isDying.current) {
        activePowerUps.current.forEach((expiry, type) => {
            const nowTime = Date.now(), pulse = Math.sin(nowTime / 150) * 0.2 + 0.8;
            if (type === PowerUpType.SHIELD) {
                const r = PLAYER_SIZE * 1.1, cx = playerPos.current.x + PLAYER_SIZE / 2, cy = playerPos.current.y + PLAYER_SIZE / 2;
                ctx.save(); ctx.translate(cx, cy); ctx.rotate(nowTime / 800);
                const g = ctx.createRadialGradient(0, 0, r * 0.8, 0, 0, r * 1.4);
                g.addColorStop(0, 'rgba(0, 255, 255, 0)'); g.addColorStop(0.5, `rgba(0, 255, 255, ${0.4 * pulse})`); g.addColorStop(1, 'rgba(0, 255, 255, 0)');
                ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, r * 1.4, 0, Math.PI * 2); ctx.fill();
                ctx.strokeStyle = `rgba(0, 255, 255, ${0.7 * pulse})`; ctx.lineWidth = 3; ctx.setLineDash([8, 6]); ctx.beginPath(); ctx.arc(0, 0, r * 1.2, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
                ctx.restore();
            }
            if (type === PowerUpType.BOOST) { ctx.fillStyle = `rgba(255, 255, 0, ${0.3 * pulse})`; ctx.fillRect(playerPos.current.x - 10, playerPos.current.y - 10, PLAYER_SIZE + 20, PLAYER_SIZE + 20); }
        });
    }

    obstacles.current.forEach(obs => {
      ctx.shadowBlur = 10;
      if (obs.type === 'spike') { ctx.fillStyle = environment.secondaryColor; ctx.shadowColor = environment.secondaryColor; ctx.beginPath(); ctx.moveTo(obs.x, obs.y + obs.height); ctx.lineTo(obs.x + obs.width / 2, obs.y); ctx.lineTo(obs.x + obs.width, obs.y + obs.height); ctx.fill(); }
      else if (obs.type === 'wall') { ctx.fillStyle = environment.secondaryColor; ctx.shadowColor = environment.secondaryColor; ctx.fillRect(obs.x, obs.y, obs.width, obs.height); }
      else if (obs.type === 'drone') { ctx.fillStyle = environment.secondaryColor; ctx.shadowColor = environment.secondaryColor; ctx.fillRect(obs.x, obs.y, obs.width, obs.height / 2); ctx.fillRect(obs.x + 5, obs.y + obs.height / 2, obs.width - 10, obs.height / 2); }
      else if (obs.type === 'mine') {
        const pulse = Math.sin(Date.now() / 100) * 0.5 + 0.5; ctx.fillStyle = '#ff3333'; ctx.shadowColor = '#ff3333'; ctx.shadowBlur = 15 + pulse * 10;
        ctx.beginPath(); ctx.arc(obs.x + obs.width/2, obs.y + obs.height/2, obs.width/2, 0, Math.PI * 2); ctx.fill();
      } else if (obs.type === 'laser') {
        const active = obs.state.active; ctx.globalAlpha = active ? 1.0 : 0.2; ctx.fillStyle = '#ff00ff'; ctx.shadowColor = '#ff00ff'; ctx.shadowBlur = active ? 20 : 5; ctx.fillRect(obs.x + obs.width/2 - 2, 0, 4, GROUND_Y); ctx.globalAlpha = 1.0;
      } else if (obs.type === 'saw') {
        ctx.save(); ctx.translate(obs.x + obs.width/2, obs.y + obs.height/2); ctx.rotate(obs.state.rotation); ctx.fillStyle = '#94a3b8'; ctx.shadowColor = environment.secondaryColor; ctx.shadowBlur = 10;
        ctx.beginPath(); const nt = 8; for(let i=0; i<nt; i++) { const ang = (i / nt) * Math.PI * 2; ctx.lineTo(Math.cos(ang) * obs.width/2, Math.sin(ang) * obs.height/2); ctx.lineTo(Math.cos(ang + 0.2) * obs.width/3, Math.sin(ang + 0.2) * obs.height/3); }
        ctx.closePath(); ctx.fill(); ctx.restore();
      } else if (obs.type === 'stomp') { 
        const isActive = obs.state.stage === 'dropping' || obs.state.stage === 'rising';
        const color = environment.secondaryColor;
        ctx.shadowColor = color; ctx.shadowBlur = isActive ? 20 : 5;
        ctx.fillStyle = '#1e293b'; ctx.fillRect(obs.x + obs.width/4, 0, obs.width/2, obs.y);
        ctx.fillStyle = color; ctx.fillRect(obs.x, obs.y, obs.width, obs.height);
        ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 2; ctx.strokeRect(obs.x + 5, obs.y + 5, obs.width - 10, obs.height - 10);
        const pulse = Math.sin(Date.now() / 150) * 0.5 + 0.5;
        ctx.fillStyle = `rgba(255, 255, 255, ${pulse * 0.8})`; ctx.fillRect(obs.x + obs.width/2 - 5, obs.y + obs.height/2 - 5, 10, 10);
        if (obs.state.stage === 'waiting') {
          const wAlpha = Math.sin(Date.now() / 100) * 0.3 + 0.4;
          ctx.strokeStyle = `rgba(255, 0, 0, ${wAlpha})`; ctx.setLineDash([5, 5]); ctx.beginPath(); ctx.moveTo(obs.x + obs.width/2, 0); ctx.lineTo(obs.x + obs.width/2, GROUND_Y); ctx.stroke(); ctx.setLineDash([]);
        }
      } else if (obs.type === 'missile') { ctx.fillStyle = '#f87171'; ctx.shadowColor = '#ef4444'; ctx.shadowBlur = 20; ctx.beginPath(); ctx.moveTo(obs.x + obs.width, obs.y + obs.height/2); ctx.lineTo(obs.x, obs.y); ctx.lineTo(obs.x + 10, obs.y + obs.height/2); ctx.lineTo(obs.x, obs.y + obs.height); ctx.closePath(); ctx.fill(); }
      ctx.shadowBlur = 0;
    });

    if (lastSocialMsg && Date.now() - lastSocialMsg.time < 2000) {
      ctx.fillStyle = lastSocialMsg.color || '#ffffff'; ctx.font = 'bold 32px Orbitron'; ctx.textAlign = 'center';
      ctx.shadowColor = lastSocialMsg.color || '#ff00ff'; ctx.shadowBlur = 10;
      ctx.fillText(lastSocialMsg.text, CANVAS_WIDTH/2, 100);
      ctx.shadowBlur = 0;
    }

    if (isDying.current) {
        const v = ctx.createRadialGradient(CANVAS_WIDTH/2, CANVAS_HEIGHT/2, 0, CANVAS_WIDTH/2, CANVAS_HEIGHT/2, CANVAS_WIDTH);
        v.addColorStop(0, 'transparent'); v.addColorStop(1, 'rgba(255, 0, 0, 0.25)'); ctx.fillStyle = v; ctx.fillRect(-20, -20, CANVAS_WIDTH + 40, CANVAS_HEIGHT + 40);
    }
    
    ctx.restore(); 
  }, [environment, lastSocialMsg]);

  const animate = useCallback((time: number) => {
    const canvas = canvasRef.current;
    if (canvas) { const ctx = canvas.getContext('2d'); if (ctx) { update(); draw(ctx); } }
    requestRef.current = requestAnimationFrame(animate);
  }, [update, draw]);

  useEffect(() => {
    requestRef.current = requestAnimationFrame(animate);
    return () => { if (requestRef.current) cancelAnimationFrame(requestRef.current); };
  }, [animate]);

  const getPowerUpIconLabel = (type: PowerUpType) => type;
  const getPowerUpColor = (type: PowerUpType) => {
    if (type === PowerUpType.SHIELD) return '#00ffff';
    if (type === PowerUpType.BOOST) return '#ffff00';
    return '#ff00ff';
  };
  const renderPowerUpIcon = (type: PowerUpType) => {
    const color = getPowerUpColor(type);
    if (type === PowerUpType.MULTIPLIER) return <div className="font-orbitron font-bold text-lg" style={{ color }}>2X</div>;
    return <svg viewBox="0 0 24 24" className="w-6 h-6" fill="none" stroke={color} strokeWidth="2"><path d={type === PowerUpType.SHIELD ? "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" : "M13 2L3 14h9l-1 8 10-12h-9l1-8z"} /></svg>;
  };

  return (
    <div className="relative w-full max-w-4xl mx-auto aspect-[2/1] bg-slate-900 rounded-xl overflow-hidden border-2 border-slate-700 shadow-2xl">
      <canvas ref={canvasRef} width={CANVAS_WIDTH} height={CANVAS_HEIGHT} className="w-full h-full block" />
      {hasMultiplier && <div className="absolute top-4 left-4 bg-fuchsia-600/90 text-white font-orbitron font-bold text-lg px-4 py-1 rounded-sm shadow-[0_0_15px_rgba(192,38,211,0.6)] animate-pulse border border-fuchsia-400/50 z-20">X2 MULTIPLIER</div>}
      <div className="absolute top-4 right-4 flex flex-col gap-3 pointer-events-none z-10">
        {activeHudPowerUps.map((pup) => {
          const isCritical = pup.timeLeft < 2000;
          const isLowTime = pup.timeLeft < 3000; 
          const color = getPowerUpColor(pup.type);
          return (
            <div key={pup.type} className={`flex items-center gap-4 bg-slate-950/80 backdrop-blur-lg px-4 py-3 rounded-lg border shadow-2xl transition-all duration-300 min-w-[180px] ${isCritical ? 'border-red-500/50 animate-pulse scale-105 shadow-[0_0_20px_rgba(239,68,68,0.2)]' : 'border-white/10'}`}>
              <div 
                className={`relative w-12 h-12 flex items-center justify-center shrink-0 transition-all duration-500 ${isLowTime ? 'animate-pulse' : ''}`}
                style={isLowTime ? { filter: `drop-shadow(0 0 12px ${color}) drop-shadow(0 0 4px ${color})` } : {}}
              >
                <svg className="absolute inset-0 w-full h-full -rotate-90"><circle cx="24" cy="24" r="21" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="3" /><circle cx="24" cy="24" r="21" fill="none" stroke={isCritical ? '#ef4444' : color} strokeWidth="3" strokeDasharray={`${2 * Math.PI * 21}`} strokeDashoffset={`${2 * Math.PI * 21 * (1 - pup.percent / 100)}`} className="transition-all duration-100 ease-linear" strokeLinecap="round" /></svg>
                {renderPowerUpIcon(pup.type)}
              </div>
              <div className="flex flex-col gap-1 w-full overflow-hidden">
                <div className="flex justify-between items-end"><span className={`text-[10px] font-bold font-orbitron uppercase tracking-widest ${isCritical ? 'text-red-400' : 'text-white/60'}`}>{getPowerUpIconLabel(pup.type)}</span><span className={`text-[14px] font-orbitron font-bold tabular-nums leading-none ${isCritical ? 'text-red-400' : 'text-white'}`}>{(pup.timeLeft / 1000).toFixed(1)}s</span></div>
                <div className="h-1 w-full bg-white/5 rounded-full overflow-hidden"><div className="h-full transition-all duration-100 ease-linear" style={{ width: `${pup.percent}%`, backgroundColor: isCritical ? '#ef4444' : color }} /></div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
