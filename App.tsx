
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { GameState, Environment, SocialEvent } from './types';
import { GameCanvas } from './components/GameCanvas';
import { fetchNewEnvironment, fetchChatComments } from './services/geminiService';

const DEFAULT_ENVIRONMENT: Environment = {
  name: "Neon Gutter",
  primaryColor: "#00f2ff",
  secondaryColor: "#ff00ea",
  description: "The baseline of the rift. High voltage, low mercy.",
  atmosphere: "electric"
};

const App: React.FC = () => {
  const [gameState, setGameState] = useState<GameState>(GameState.START);
  const [score, setScore] = useState(0);
  const [highScore, setHighScore] = useState(0);
  const [clout, setClout] = useState(0);
  const [environment, setEnvironment] = useState<Environment>(DEFAULT_ENVIRONMENT);
  const [biomeHistory, setBiomeHistory] = useState<string[]>([DEFAULT_ENVIRONMENT.name]);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [streamerName, setStreamerName] = useState('Rift_Walker');
  const lastShiftRef = useRef<number>(0);
  const lastChatFetchRef = useRef<number>(0);

  const handleBiomeShift = useCallback(async (currentScore: number) => {
    if (isTransitioning) return;
    setIsTransitioning(true);
    
    try {
      const newEnv = await fetchNewEnvironment(currentScore, biomeHistory);
      if (newEnv) {
        setEnvironment(newEnv);
        setBiomeHistory(prev => [...prev, newEnv.name]);
      }
    } catch (err) {
      // Errors are now handled silently in the service returning fallbacks
    } finally {
      // Significant cooldown (30s) to prevent any burst of requests
      setTimeout(() => setIsTransitioning(false), 30000);
    }
  }, [biomeHistory, isTransitioning]);

  useEffect(() => {
    if (gameState !== GameState.PLAYING) return;
    
    // Increased milestone significantly to 5000 to drastically reduce API call frequency
    const milestone = Math.floor(score / 5000);
    if (milestone > lastShiftRef.current && !isTransitioning) {
      lastShiftRef.current = milestone;
      handleBiomeShift(score);
    }
  }, [score, isTransitioning, gameState, handleBiomeShift]);

  const handleSocialEvent = useCallback(async (event: SocialEvent) => {
    if (event === 'COLLECT') setClout(prev => prev + 10);
    else if (event === 'NEAR_MISS') setClout(prev => prev + 100);
    else if (event === 'LEVEL_UP') setClout(prev => prev + 500);
  }, []);

  const startGame = useCallback(() => {
    setGameState(GameState.PLAYING);
    setScore(0);
    setClout(0);
    setEnvironment(DEFAULT_ENVIRONMENT);
    setBiomeHistory([DEFAULT_ENVIRONMENT.name]);
    lastShiftRef.current = 0;
    lastChatFetchRef.current = 0;
  }, []);

  const handleGameOver = useCallback((finalScore: number) => {
    setGameState(GameState.GAMEOVER);
    setScore(finalScore);
    if (finalScore > highScore) setHighScore(finalScore);
  }, [highScore]);

  return (
    <div className="min-h-screen bg-slate-950 text-white flex flex-col p-4 relative overflow-hidden font-rajdhani">
      <div className="absolute inset-0 opacity-20 pointer-events-none transition-colors duration-1000" style={{ background: `radial-gradient(circle at 50% 50%, ${environment.primaryColor} 0%, transparent 70%)` }} />

      <div className="z-10 w-full max-w-4xl mx-auto flex flex-col gap-6 flex-1 h-full justify-center">
        <div className="flex flex-col gap-4">
          <div className="flex justify-between items-center bg-slate-900/50 backdrop-blur p-4 rounded-xl border border-white/10">
            <div className="flex items-center gap-4">
              <div className="relative">
                <div className="absolute inset-0 bg-red-600 rounded-full animate-ping opacity-75" />
                <div className="relative px-3 py-1 bg-red-600 rounded text-xs font-bold uppercase tracking-widest font-orbitron">Live</div>
              </div>
              <div className="flex flex-col">
                <span className="text-xl font-orbitron font-bold tracking-tight" style={{ color: environment.primaryColor }}>
                  {streamerName.toUpperCase()}'S STREAM
                </span>
                <span className="text-xs text-slate-400 font-bold uppercase tracking-widest">
                   {score.toLocaleString()} VIEWERS • {environment.name}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-6">
              <div className="text-right">
                <div className="text-[10px] uppercase text-slate-500 font-bold tracking-widest">Total Clout</div>
                <div className="text-xl font-bold font-orbitron text-fuchsia-400">❤️ {clout.toLocaleString()}</div>
              </div>
              <div className="text-right hidden sm:block">
                <div className="text-[10px] uppercase text-slate-500 font-bold tracking-widest">Peak Reach</div>
                <div className="text-xl font-bold font-orbitron text-yellow-500">{highScore.toLocaleString()}</div>
              </div>
            </div>
          </div>

          <div className="relative bg-black rounded-xl overflow-hidden border border-slate-800 shadow-2xl shadow-black">
            <GameCanvas 
              gameState={gameState} 
              onGameOver={handleGameOver}
              environment={environment}
              onScoreUpdate={setScore}
              onSocialEvent={handleSocialEvent}
            />

            {gameState === GameState.START && (
              <div className="absolute inset-0 bg-slate-950/95 backdrop-blur flex flex-col items-center justify-center text-center p-8 z-50">
                <div className="mb-8">
                  <h2 className="text-6xl font-orbitron font-bold mb-2 tracking-tighter italic text-transparent bg-clip-text bg-gradient-to-br from-white to-slate-500">RIFT STREAMER</h2>
                  <div className="h-0.5 w-full bg-gradient-to-r from-transparent via-fuchsia-500 to-transparent" />
                </div>
                
                <div className="w-full max-w-sm space-y-4 mb-8">
                  <div className="text-[10px] text-slate-500 font-bold uppercase tracking-[0.3em]">Configure Streamer Handle</div>
                  <input 
                    type="text"
                    value={streamerName}
                    onChange={(e) => setStreamerName(e.target.value.replace(/[^a-zA-Z0-9_]/g, '').slice(0, 15))}
                    placeholder="ENTER_HANDLE..."
                    className="w-full bg-slate-900 border-2 border-slate-800 rounded-lg px-6 py-4 font-orbitron text-center text-xl tracking-widest text-white focus:outline-none focus:border-fuchsia-500 focus:ring-1 focus:ring-fuchsia-500 transition-all placeholder:text-slate-700"
                  />
                  <p className="text-slate-500 text-xs italic">"Dodge obstacles, farm clout, and don't crash the feed."</p>
                </div>

                <button 
                  onClick={startGame} 
                  className="group relative px-16 py-5 bg-white text-black font-orbitron font-bold text-2xl rounded-full hover:scale-110 transition-transform active:scale-95 shadow-[0_0_40px_rgba(255,255,255,0.3)]"
                >
                  <div className="absolute inset-0 bg-white blur-md group-hover:blur-xl transition-all rounded-full opacity-50" />
                  <span className="relative">GO LIVE</span>
                </button>
              </div>
            )}

            {gameState === GameState.GAMEOVER && (
              <div className="absolute inset-0 bg-black/95 backdrop-blur-xl flex flex-col items-center justify-center text-center p-8 z-50 animate-in zoom-in duration-300">
                <div className="mb-6">
                  <h2 className="text-6xl font-orbitron font-bold text-red-500 mb-2 drop-shadow-[0_0_15px_rgba(239,68,68,0.5)]">FEED DISCONNECTED</h2>
                  <div className="text-slate-400 font-bold uppercase tracking-[0.4em] text-xs">Broadcast Terminated for {streamerName}</div>
                </div>

                <div className="grid grid-cols-2 gap-12 mb-10">
                   <div className="text-center">
                      <div className="text-[10px] text-slate-500 uppercase font-bold tracking-widest mb-1">Final Viewers</div>
                      <div className="text-4xl font-orbitron font-bold text-white">{score.toLocaleString()}</div>
                   </div>
                   <div className="text-center">
                      <div className="text-[10px] text-slate-500 uppercase font-bold tracking-widest mb-1">Total Clout</div>
                      <div className="text-4xl font-orbitron font-bold text-fuchsia-500">❤️ {clout.toLocaleString()}</div>
                   </div>
                </div>

                <div className="flex gap-4 w-full max-w-md">
                  <button onClick={startGame} className="flex-1 px-8 py-4 bg-red-600 text-white font-orbitron font-bold rounded-lg hover:bg-red-500 transition-all hover:shadow-[0_0_20px_rgba(220,38,38,0.4)]">RESTART FEED</button>
                  <button onClick={() => setGameState(GameState.START)} className="flex-1 px-8 py-4 bg-slate-800 text-white font-orbitron font-bold rounded-lg hover:bg-slate-700 transition-all border border-slate-700">EDIT PROFILE</button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default App;
