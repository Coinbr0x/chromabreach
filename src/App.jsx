import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, ArrowRight, Monitor, Gamepad, Compass, Radio, Cpu, Layers } from 'lucide-react';

// Custom typewriter hook as specified in DESIGN.md (with side-effect free index incrementing for React StrictMode)
function useTypewriter(text, speed = 38, startDelay = 600) {
  const [index, setIndex] = useState(0);
  const [done, setDone] = useState(false);

  useEffect(() => {
    setIndex(0);
    setDone(false);

    const timeoutId = setTimeout(() => {
      const intervalId = setInterval(() => {
        setIndex((prev) => {
          if (prev < text.length) {
            return prev + 1;
          } else {
            clearInterval(intervalId);
            setDone(true);
            return prev;
          }
        });
      }, speed);

      return () => clearInterval(intervalId);
    }, startDelay);

    return () => clearTimeout(timeoutId);
  }, [text, speed, startDelay]);

  return { displayed: text.slice(0, index), done };
}

export default function App() {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [selectedServices, setSelectedServices] = useState([]);

  // Typewriter hook usage
  const { displayed: typewriterText, done: typewriterDone } = useTypewriter(
    "we'd love to\nhear from you!",
    38,
    600
  );

  // Detect mobile — skip video entirely on mobile devices
  const isMobile = typeof navigator !== 'undefined' && (
    /Android|iPhone|iPad|iPod|webOS|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
    || (navigator.maxTouchPoints > 1 && window.innerWidth < 1024)
  );

  // Canvas-based frame scrubbing: extract all frames upfront, draw on scroll (zero decoder lag)
  const canvasRef = useRef(null);
  const framesRef = useRef([]); // Array of ImageBitmap
  const targetFrameRef = useRef(0);
  const currentFrameRef = useRef(0);
  const totalFramesRef = useRef(0);
  const [framesReady, setFramesReady] = useState(isMobile); // Skip loading on mobile
  const [loadProgress, setLoadProgress] = useState(isMobile ? 100 : 0);

  useEffect(() => {
    // Skip all video work on mobile
    if (isMobile) return;

    const canvas = canvasRef.current;

    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    let animationFrameId;
    let objectUrl = null;
    let cancelled = false;

    const TOTAL_FRAMES = 60;

    // Promise with timeout helper — rejects if timeout exceeded
    const withTimeout = (promise, ms, label) => {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Timeout: ${label} after ${ms}ms`)), ms);
        promise.then((val) => { clearTimeout(timer); resolve(val); })
          .catch((err) => { clearTimeout(timer); reject(err); });
      });
    };

    // Extract all frames from video into ImageBitmap array
    const extractFrames = async (videoSrc) => {
      const video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      video.preload = 'auto';
      video.crossOrigin = 'anonymous';
      video.setAttribute('webkit-playsinline', 'true');
      video.src = videoSrc;

      // Wait for metadata with 8s timeout
      await withTimeout(
        new Promise((resolve, reject) => {
          video.onloadedmetadata = resolve;
          video.onerror = reject;
        }),
        8000,
        'loadedmetadata'
      );

      // Wait for enough data to seek with 8s timeout
      await withTimeout(
        new Promise((resolve) => {
          if (video.readyState >= 2) return resolve();
          video.oncanplay = resolve;
        }),
        8000,
        'canplay'
      );


      const duration = video.duration;
      const w = video.videoWidth;
      const h = video.videoHeight;

      // Set canvas to video dimensions
      canvas.width = w;
      canvas.height = h;

      const frames = [];
      const offscreen = document.createElement('canvas');
      offscreen.width = w;
      offscreen.height = h;
      const offCtx = offscreen.getContext('2d');

      let consecutiveFailures = 0;

      for (let i = 0; i < TOTAL_FRAMES; i++) {
        if (cancelled) break;

        const targetTime = (i / (TOTAL_FRAMES - 1)) * duration;
        video.currentTime = targetTime;

        try {
          // Wait for seek with 3s timeout per frame
          await withTimeout(
            new Promise((resolve) => {
              video.onseeked = resolve;
            }),
            3000,
            `seek frame ${i}`
          );

          offCtx.drawImage(video, 0, 0, w, h);
          const bitmap = await createImageBitmap(offscreen);
          frames.push(bitmap);
          consecutiveFailures = 0;
        } catch (_) {
          // Seek timed out — skip this frame
          consecutiveFailures++;
          console.warn(`Frame ${i} seek timed out, skipping`);

          // If 5 consecutive frames fail, the decoder is stuck — abort early
          if (consecutiveFailures >= 5) {
            console.warn('Too many consecutive seek failures, aborting extraction');
            break;
          }
        }

        // Report progress: 10-100% (first 10% reserved for video download)
        setLoadProgress(10 + Math.round(((i + 1) / TOTAL_FRAMES) * 90));
      }

      // Clean up the temporary video
      video.src = '';
      video.load();

      return frames;
    };

    // Scroll handler — just updates target frame index
    const handleScroll = () => {
      if (totalFramesRef.current === 0) return;
      const scrollableHeight = document.documentElement.scrollHeight - window.innerHeight;
      if (scrollableHeight <= 0) return;
      const scrollPercent = window.scrollY / scrollableHeight;
      targetFrameRef.current = scrollPercent * (totalFramesRef.current - 1);
    };

    // Resize handler — match canvas display size to container
    const handleResize = () => {
      handleScroll();
    };

    // Smooth animation loop — lerp between current and target frame, draw to canvas
    const renderLoop = () => {
      const frames = framesRef.current;
      if (frames.length === 0) {
        animationFrameId = requestAnimationFrame(renderLoop);
        return;
      }

      const diff = targetFrameRef.current - currentFrameRef.current;

      if (Math.abs(diff) > 0.05) {
        // Smooth lerp for buttery frame transitions
        currentFrameRef.current += diff * 0.15;
      } else {
        currentFrameRef.current = targetFrameRef.current;
      }

      // Clamp and round to nearest frame
      const frameIndex = Math.max(0, Math.min(frames.length - 1, Math.round(currentFrameRef.current)));
      const frame = frames[frameIndex];

      if (frame) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(frame, 0, 0, canvas.width, canvas.height);
      }

      animationFrameId = requestAnimationFrame(renderLoop);
    };

    // Kick off frame extraction
    const init = async () => {
      try {
        // Fetch video as blob for in-memory access (track download progress)
        const res = await fetch('/Untitled design (1).mp4');
        const reader = res.body.getReader();
        const contentLength = +res.headers.get('Content-Length') || 0;
        const chunks = [];
        let received = 0;

        while (true) {
          const { done: readerDone, value } = await reader.read();
          if (readerDone) break;
          chunks.push(value);
          received += value.length;
          if (contentLength > 0) {
            // Download is 0-10% of total progress
            setLoadProgress(Math.round((received / contentLength) * 10));
          }
        }

        const blob = new Blob(chunks, { type: 'video/mp4' });
        objectUrl = URL.createObjectURL(blob);

        if (cancelled) return;

        const frames = await extractFrames(objectUrl);

        if (cancelled) {
          frames.forEach((f) => f.close());
          return;
        }

        framesRef.current = frames;
        totalFramesRef.current = Math.max(frames.length, 1);
        setLoadProgress(100);
        setFramesReady(true);

        // Draw first frame immediately
        handleScroll();
        const firstIdx = Math.min(Math.round(targetFrameRef.current), frames.length - 1);
        if (frames[firstIdx]) {
          ctx.drawImage(frames[firstIdx], 0, 0, canvas.width, canvas.height);
          currentFrameRef.current = firstIdx;
        }
      } catch (err) {
        console.error('Frame extraction failed:', err);
        // Graceful degradation: reveal the site even if extraction failed
        setLoadProgress(100);
        setFramesReady(true);
      }
    };

    init();

    // Start render loop immediately (will no-op until frames are ready)
    animationFrameId = requestAnimationFrame(renderLoop);

    window.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('resize', handleResize);

    return () => {
      cancelled = true;
      window.removeEventListener('scroll', handleScroll);
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(animationFrameId);
      // Release ImageBitmap GPU memory
      framesRef.current.forEach((f) => f.close());
      framesRef.current = [];
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, []);

  // Multi-select service pills logic
  const serviceOptions = ["Brand", "Digital", "Campaign", "Other"];

  const handlePillClick = (service) => {
    setSelectedServices((prev) =>
      prev.includes(service)
        ? prev.filter(s => s !== service)
        : [...prev, service]
    );
  };

  const scrollToSection = (id) => {
    setIsMobileMenuOpen(false);
    const element = document.getElementById(id);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth' });
    }
  };

  // Prevent scrolling during loading
  useEffect(() => {
    if (!framesReady) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [framesReady]);

  // SVG progress pie constants
  const PIE_RADIUS = 54;
  const PIE_CIRCUMFERENCE = 2 * Math.PI * PIE_RADIUS;
  const pieOffset = PIE_CIRCUMFERENCE - (loadProgress / 100) * PIE_CIRCUMFERENCE;

  return (
    // General Page Structure (adapted for Cyberpunk theme)
    <div className="relative bg-cyber-dark text-white font-sans selection:bg-cyber-pink selection:text-white antialiased overflow-x-hidden flex flex-col lg:block lg:min-h-screen">

      {/* Loading Overlay with Progress Pie */}
      <AnimatePresence>
        {!framesReady && (
          <motion.div
            key="loading-overlay"
            initial={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.8, ease: 'easeInOut' }}
            className="fixed inset-0 z-[9999] bg-cyber-dark flex flex-col items-center justify-center gap-6 select-none"
          >
            {/* Ambient background glow */}
            <div className="absolute inset-0 pointer-events-none">
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[400px] h-[400px] rounded-full bg-cyber-purple/10 blur-[120px]" />
              <div className="absolute top-1/3 left-1/3 w-[200px] h-[200px] rounded-full bg-cyber-cyan/8 blur-[80px]" />
            </div>

            {/* Progress Ring */}
            <div className="relative">
              <svg width="140" height="140" viewBox="0 0 140 140" className="-rotate-90">
                {/* Track ring */}
                <circle
                  cx="70" cy="70" r={PIE_RADIUS}
                  fill="none" stroke="rgba(157, 78, 221, 0.15)" strokeWidth="6"
                />
                {/* Progress ring */}
                <circle
                  cx="70" cy="70" r={PIE_RADIUS}
                  fill="none"
                  stroke="url(#progressGradient)"
                  strokeWidth="6"
                  strokeLinecap="round"
                  strokeDasharray={PIE_CIRCUMFERENCE}
                  strokeDashoffset={pieOffset}
                  style={{ transition: 'stroke-dashoffset 0.15s ease-out' }}
                />
                <defs>
                  <linearGradient id="progressGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#00f0ff" />
                    <stop offset="50%" stopColor="#9d4edd" />
                    <stop offset="100%" stopColor="#ff007f" />
                  </linearGradient>
                </defs>
              </svg>
              {/* Percentage text in center */}
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-2xl font-mono font-bold text-white tabular-nums">
                  {loadProgress}<span className="text-cyber-cyan text-lg">%</span>
                </span>
              </div>
            </div>

            {/* Status text */}
            <div className="text-center space-y-2">
              <p className="text-sm font-mono text-cyber-cyan tracking-widest uppercase animate-pulse">
                {loadProgress < 10 ? 'DOWNLOADING ASSETS' : 'EXTRACTING FRAMES'}
              </p>
              <p className="text-xs font-mono text-neutral-500 tracking-wider">
                INITIALIZING NEURAL VIEWPORT
              </p>
            </div>

            {/* Decorative scanline */}
            <div className="absolute inset-0 scanline opacity-5 pointer-events-none" />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Background Video Frames (Fixed behind content, rendered to canvas) */}
      <div className="fixed inset-0 z-0 overflow-hidden pointer-events-none w-full h-full bg-cyber-dark">
        <canvas
          ref={canvasRef}
          className="w-full h-full object-contain object-center opacity-40 lg:opacity-30 filter saturate-150 contrast-125"
          style={{ willChange: 'transform', transform: 'translateZ(0)' }}
        />
        {/* Neon grid overlay behind content */}
        <div className="absolute inset-0 cyber-grid opacity-30 pointer-events-none" />
        <div className="absolute inset-0 scanline opacity-10 pointer-events-none" />
        {/* Bottom fade */}
        <div className="absolute inset-x-0 bottom-0 h-48 bg-gradient-to-t from-cyber-dark to-transparent" />
      </div>

      {/* Interactive Navbar */}
      <header className="fixed top-0 inset-x-0 z-50 px-5 sm:px-8 py-4 sm:py-5 flex flex-row justify-between items-center bg-cyber-dark/80 backdrop-blur-md border-b border-cyber-purple/10">
        {/* Logo (Left side) */}
        <div className="flex flex-row items-center gap-3 cursor-pointer select-none" onClick={() => scrollToSection('spade-hero')}>
          <span className="text-[21px] sm:text-[26px] tracking-tight font-medium font-mono text-white neon-text-cyan">
            CHROMA BREACH
          </span>
          <span className="text-[25px] sm:text-[30px] text-cyber-pink select-none tracking-[-0.02em] font-medium leading-none mb-1 animate-pulse">
            &#10033;
          </span>
        </div>

        {/* Desktop Nav Links (Center) */}
        <nav className="hidden md:flex flex-row items-center gap-1 text-[18px] font-mono tracking-wider">
          <button onClick={() => scrollToSection('overview')} className="text-white/80 hover:text-cyber-cyan transition-colors px-2">Overview</button>
          <span className="opacity-40 text-cyber-purple">,&nbsp;</span>
          <button onClick={() => scrollToSection('media')} className="text-white/80 hover:text-cyber-cyan transition-colors px-2">Media</button>
          <span className="opacity-40 text-cyber-purple">,&nbsp;</span>
          <button onClick={() => scrollToSection('waitlist')} className="text-white/80 hover:text-cyber-cyan transition-colors px-2">Waitlist</button>
          <span className="opacity-40 text-cyber-purple">,&nbsp;</span>
          <a href="https://github.com/Coinbr0x/chromabreach" target="_blank" rel="noreferrer" className="text-white/80 hover:text-cyber-cyan transition-colors px-2">Source</a>
        </nav>

        {/* Desktop CTA (Right) */}
        <div className="hidden md:block">
          <button
            onClick={() => scrollToSection('waitlist')}
            className="text-[18px] text-cyber-pink font-mono tracking-widest uppercase border border-cyber-pink/40 px-4 py-2 hover:bg-cyber-pink/15 hover:shadow-[0_0_15px_rgba(255,0,127,0.4)] transition-all duration-300 relative group overflow-hidden"
          >
            <span className="relative z-10">Access Grid</span>
            <span className="absolute inset-0 -translate-x-full group-hover:translate-x-0 bg-cyber-pink/20 transition-transform duration-300" />
          </button>
        </div>

        {/* Hamburger button visible below md */}
        <button
          onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
          className="md:hidden flex flex-col justify-between h-[14px] w-6 z-50 relative focus:outline-none"
          aria-label="Toggle Menu"
        >
          <span className={`w-6 h-[2px] bg-cyber-pink transition-all duration-300 ${isMobileMenuOpen ? 'rotate-45 translate-y-[6px]' : ''}`} />
          <span className={`w-6 h-[2px] bg-cyber-cyan transition-all duration-300 ${isMobileMenuOpen ? 'opacity-0' : ''}`} />
          <span className={`w-6 h-[2px] bg-cyber-pink transition-all duration-300 ${isMobileMenuOpen ? '-rotate-45 -translate-y-[6px]' : ''}`} />
        </button>

        {/* Mobile Navigation Overlay */}
        <div
          className={`fixed inset-0 z-40 bg-cyber-dark/95 backdrop-blur-md flex flex-col justify-center items-center transition-all duration-300 ${isMobileMenuOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
            }`}
        >
          <nav className="flex flex-col gap-8 text-center text-2xl font-mono">
            <button onClick={() => scrollToSection('overview')} className="text-white hover:text-cyber-cyan transition-colors">Overview</button>
            <button onClick={() => scrollToSection('media')} className="text-white hover:text-cyber-pink transition-colors">Media</button>
            <button onClick={() => scrollToSection('waitlist')} className="text-white hover:text-cyber-cyan transition-colors">Waitlist</button>
            <button
              onClick={() => scrollToSection('waitlist')}
              className="mt-4 px-8 py-3 border border-cyber-pink text-cyber-pink hover:bg-cyber-pink/10 transition-colors uppercase tracking-widest text-lg"
            >
              Join Waitlist
            </button>
          </nav>
        </div>
      </header>

      {/* Content Layout Container */}
      <div className="relative z-10 flex flex-col w-full pb-8 lg:pb-0 lg:min-h-screen pt-24 sm:pt-28">

        {/* Overarching layout engine */}
        <main id="spade-hero" className="w-full max-w-7xl mx-auto px-6 py-12 flex-1 flex flex-col justify-center">

          {/* Hero Section Info */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center mb-16">
            <div className="lg:col-span-7 space-y-6 text-left">
              <div className="inline-flex items-center gap-2 px-3 py-1 bg-cyber-pink/10 border border-cyber-pink/30 text-cyber-pink text-xs font-mono tracking-wider uppercase rounded-full">
                <span className="w-2 h-2 rounded-full bg-cyber-pink animate-pulse" />
                VIRTUAL NODE DETECTED // PROTOCOL 77
              </div>

              <h1 className="text-5xl md:text-6xl lg:text-7xl font-extrabold font-mono tracking-tight text-white leading-tight">
                BREACH THE GRID.<br />
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyber-cyan via-cyber-purple to-cyber-pink neon-text-pink">
                  RECLAIM CHROMA.
                </span>
              </h1>

              <p className="text-lg md:text-xl text-neutral-300 leading-relaxed font-sans max-w-2xl">
                Armed with color-coded hacking modules, dive into the core of OmniCorp. Match wavelengths, disrupt hostile firewalls, and bypass lethal neural protocols. A synthwave-infused roguelike of tactical spectrum control.
              </p>

              {/* Waitlist and Platform Availability */}
              <div className="flex flex-col sm:flex-row sm:items-center gap-6 pt-4">
                <button
                  onClick={() => scrollToSection('waitlist')}
                  className="px-8 py-4 bg-gradient-to-r from-cyber-pink to-cyber-purple text-white font-mono uppercase tracking-widest font-semibold hover:shadow-[0_0_20px_rgba(255,0,127,0.6)] transition-all duration-300 flex items-center justify-center gap-3 group"
                >
                  Join the Waitlist <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                </button>

                <div className="space-y-1">
                  <span className="text-xs font-mono text-cyber-cyan uppercase tracking-widest block">Available Soon on:</span>
                  <div className="flex items-center gap-3 text-neutral-400">
                    <span className="flex items-center gap-1 text-sm font-mono"><Monitor className="w-4 h-4 text-white" /> PC</span>
                    <span className="text-cyber-purple">|</span>
                    <span className="flex items-center gap-1 text-sm font-mono"><Gamepad className="w-4 h-4 text-white" /> PS5</span>
                    <span className="text-cyber-purple">|</span>
                    <span className="flex items-center gap-1 text-sm font-mono"><Layers className="w-4 h-4 text-white" /> XBOX</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="lg:col-span-5 hidden lg:block">
              {/* Interactive terminal graphic */}
              <div className="border border-cyber-cyan/30 bg-cyber-card/70 p-6 rounded-lg shadow-[0_0_30px_rgba(0,240,255,0.1)] font-mono text-xs text-cyber-cyan space-y-3 relative overflow-hidden">
                <div className="absolute top-0 right-0 px-2 py-1 bg-cyber-cyan/20 border-b border-l border-cyber-cyan/30 text-[10px] text-cyber-cyan">
                  SYS_LIVE
                </div>
                <p className="text-white/40">// DECRYPTION PIPELINE ACTIVE</p>
                <p>&gt; CONNECTING TO OMNICORP_NODE_9...</p>
                <p className="text-cyber-pink">&gt; ALERT: FIREWALL FREQUENCY IS SHIFTING [MAGENTA]</p>
                <div className="w-full bg-cyber-dark h-2 rounded border border-cyber-cyan/20 overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: "82%" }}
                    transition={{ duration: 3, repeat: Infinity, repeatType: "reverse" }}
                    className="bg-cyber-cyan h-full"
                  />
                </div>
                <p>&gt; SECURE SHELL ESTABLISHED: 192.168.7.203</p>
                <p>&gt; WAVELENGTH MATCHED: YELLOW (580NM) -- DECRYPTING...</p>
                <p className="text-cyber-green">&gt; BREACH LEVEL 4 COMPLETE. MEMORY DECK DUMPED.</p>
              </div>
            </div>
          </div>

          {/* 3 Cards displaying the screenshot images from the root */}
          <div id="media" className="space-y-6 mb-20 scroll-mt-24">
            <h2 className="text-2xl font-mono text-center tracking-widest text-cyber-cyan uppercase">
              // GAMEPLAY_CAPSULES
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">

              {/* Card 1: Game Screenshot 1 */}
              <div className="bg-cyber-card/40 border border-cyber-purple/20 hover:border-cyber-pink/50 rounded-xl overflow-hidden hover:shadow-[0_0_20px_rgba(255,0,127,0.2)] transition-all duration-300 group flex flex-col">
                <div className="bg-cyber-dark/80 px-4 py-2 border-b border-cyber-purple/10 flex justify-between items-center text-xs font-mono text-neutral-400">
                  <span className="flex items-center gap-2"><Cpu className="w-3.5 h-3.5 text-cyber-pink" /> NODE_01_CORES</span>
                  <span className="text-[10px] text-cyber-pink animate-pulse">● ACTIVE</span>
                </div>
                <div className="relative aspect-video overflow-hidden">
                  <img
                    src="/game1.png"
                    alt="Chroma Breach Screenshot 1"
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500 filter saturate-125"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-cyber-dark to-transparent opacity-60" />
                </div>
                <div className="p-5 flex-1 flex flex-col justify-between">
                  <div className="space-y-2">
                    <h3 className="text-lg font-mono text-white tracking-wide uppercase">Wavelength Spectrum Grid</h3>
                    <p className="text-sm text-neutral-400">Match active firewalls in real-time. Lock Cyan, Magenta, or Yellow protocols to initiate neural payload transfer.</p>
                  </div>
                  <div className="mt-4 pt-4 border-t border-cyber-purple/10 flex justify-between text-xs font-mono text-cyber-cyan">
                    <span>WAVE: 420NM (CYAN)</span>
                    <span>THREAT: LOW</span>
                  </div>
                </div>
              </div>

              {/* Card 2: Game Screenshot 2 */}
              <div className="bg-cyber-card/40 border border-cyber-purple/20 hover:border-cyber-cyan/50 rounded-xl overflow-hidden hover:shadow-[0_0_20px_rgba(0,240,255,0.2)] transition-all duration-300 group flex flex-col">
                <div className="bg-cyber-dark/80 px-4 py-2 border-b border-cyber-purple/10 flex justify-between items-center text-xs font-mono text-neutral-400">
                  <span className="flex items-center gap-2"><Compass className="w-3.5 h-3.5 text-cyber-cyan" /> NODE_02_GRID</span>
                  <span className="text-[10px] text-cyber-cyan animate-pulse">● STABLE</span>
                </div>
                <div className="relative aspect-video overflow-hidden">
                  <img
                    src="/game2.png"
                    alt="Chroma Breach Screenshot 2"
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500 filter saturate-125"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-cyber-dark to-transparent opacity-60" />
                </div>
                <div className="p-5 flex-1 flex flex-col justify-between">
                  <div className="space-y-2">
                    <h3 className="text-lg font-mono text-white tracking-wide uppercase">Neural Deck Upgrades</h3>
                    <p className="text-sm text-neutral-400">Install subroutine processors, kinetic dampeners, and software viruses to customize your combat configuration.</p>
                  </div>
                  <div className="mt-4 pt-4 border-t border-cyber-purple/10 flex justify-between text-xs font-mono text-cyber-cyan">
                    <span>WAVE: 580NM (YELLOW)</span>
                    <span>THREAT: MEDIUM</span>
                  </div>
                </div>
              </div>

              {/* Card 3: Game Screenshot 3 */}
              <div className="bg-cyber-card/40 border border-cyber-purple/20 hover:border-cyber-purple/50 rounded-xl overflow-hidden hover:shadow-[0_0_20px_rgba(157,78,221,0.2)] transition-all duration-300 group flex flex-col">
                <div className="bg-cyber-dark/80 px-4 py-2 border-b border-cyber-purple/10 flex justify-between items-center text-xs font-mono text-neutral-400">
                  <span className="flex items-center gap-2"><Radio className="w-3.5 h-3.5 text-cyber-purple" /> NODE_03_BREACH</span>
                  <span className="text-[10px] text-cyber-purple animate-pulse">● THREAT</span>
                </div>
                <div className="relative aspect-video overflow-hidden">
                  <img
                    src="/game3.png"
                    alt="Chroma Breach Screenshot 3"
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500 filter saturate-125"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-cyber-dark to-transparent opacity-60" />
                </div>
                <div className="p-5 flex-1 flex flex-col justify-between">
                  <div className="space-y-2">
                    <h3 className="text-lg font-mono text-white tracking-wide uppercase">Firewall Core Breach</h3>
                    <p className="text-sm text-neutral-400">Enter high-security central cores. Use spectrum combos to shatter AI defenses and override mainframe nodes.</p>
                  </div>
                  <div className="mt-4 pt-4 border-t border-cyber-purple/10 flex justify-between text-xs font-mono text-cyber-cyan">
                    <span>WAVE: 650NM (MAGENTA)</span>
                    <span>THREAT: CRITICAL</span>
                  </div>
                </div>
              </div>

            </div>
          </div>

          {/* Game Overview Section (Rendered from overview.md content) */}
          <section id="overview" className="bg-cyber-card/30 border border-cyber-cyan/15 rounded-2xl p-6 sm:p-10 mb-20 scroll-mt-24 backdrop-blur-md relative overflow-hidden">
            {/* Ambient glows inside overview card */}
            <div className="absolute -top-32 -left-32 w-64 h-64 rounded-full bg-cyber-cyan/10 blur-[100px]" />
            <div className="absolute -bottom-32 -right-32 w-64 h-64 rounded-full bg-cyber-pink/10 blur-[100px]" />

            <div className="max-w-4xl mx-auto space-y-8 text-left">
              <div className="flex items-center gap-3">
                <div className="h-px flex-1 bg-gradient-to-r from-transparent to-cyber-cyan/40" />
                <h2 className="text-3xl font-mono tracking-widest text-cyber-cyan uppercase text-center shrink-0">
                  PROTOCOL: OVERVIEW
                </h2>
                <div className="h-px flex-1 bg-gradient-to-l from-transparent to-cyber-cyan/40" />
              </div>

              <div className="space-y-6">
                <h3 className="text-2xl font-mono text-white tracking-wider">
                  BREACH THE GRID. RECLAIM THE CHROMA.
                </h3>
                <p className="text-base sm:text-lg text-neutral-300 leading-relaxed">
                  Chroma Breach is a high-octane, synthwave-infused cyberpunk roguelite action game. Enter the neural network of OmniCorp as a rogue hacker armed with a weaponized color-matching deck. Match neon wavelengths, breach corporate firewall nodes, and defeat lethal security protocols in a fast-paced battle to free the city's digital grid.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4">
                <div className="bg-cyber-dark/40 border border-cyber-purple/20 p-5 rounded-lg flex items-start gap-4">
                  <div className="p-2.5 bg-cyber-pink/10 border border-cyber-pink/20 rounded text-cyber-pink shrink-0">
                    <Radio className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="text-white font-mono font-bold mb-1">Wavelength Combat System</h4>
                    <p className="text-sm text-neutral-400">Dynamically shift your combat frequencies between Cyan, Magenta, and Yellow to break corresponding enemy firewall shields.</p>
                  </div>
                </div>

                <div className="bg-cyber-dark/40 border border-cyber-purple/20 p-5 rounded-lg flex items-start gap-4">
                  <div className="p-2.5 bg-cyber-cyan/10 border border-cyber-cyan/20 rounded text-cyber-cyan shrink-0">
                    <Cpu className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="text-white font-mono font-bold mb-1">Neural Deck Building</h4>
                    <p className="text-sm text-neutral-400">Collect and upgrade hacking modules, digital viruses, and kinetic subroutines to customize your combat style.</p>
                  </div>
                </div>

                <div className="bg-cyber-dark/40 border border-cyber-purple/20 p-5 rounded-lg flex items-start gap-4">
                  <div className="p-2.5 bg-cyber-purple/10 border border-cyber-purple/20 rounded text-cyber-purple shrink-0">
                    <Compass className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="text-white font-mono font-bold mb-1">Procedural Synth-Grid</h4>
                    <p className="text-sm text-neutral-400">Face randomized mainframe architectures where each run features unique room layouts, hostile security subroutines, and rare hack terminals.</p>
                  </div>
                </div>

                <div className="bg-cyber-dark/40 border border-cyber-purple/20 p-5 rounded-lg flex items-start gap-4">
                  <div className="p-2.5 bg-cyber-green/10 border border-cyber-green/20 rounded text-cyber-green shrink-0">
                    <Layers className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="text-white font-mono font-bold mb-1">Adaptive Soundtrack</h4>
                    <p className="text-sm text-neutral-400">A pounding retro-synthwave soundtrack that increases in intensity and tempo as your combo meter rises.</p>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* Contact / Waitlist Section with Typewriter Hook & Pills */}
          <section id="waitlist" className="max-w-4xl mx-auto w-full py-8 scroll-mt-24 text-left">

            {/* Typewriter Hook & Headline */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6 }}
              className="mb-8"
            >
              <h1 className="text-5xl md:text-6xl lg:text-[76px] font-mono font-extrabold tracking-tight text-white leading-[1.08] mb-8 select-none w-full whitespace-pre-wrap">
                {typewriterText}
                {!typewriterDone && (
                  <span className="inline-block w-[2px] h-[1.1em] bg-cyber-cyan align-middle ml-[2px] animate-blink" />
                )}
              </h1>
            </motion.div>

            {/* Secondary Description Text */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.1, duration: 0.6 }}
            >
              <p className="text-lg md:text-xl text-neutral-300 leading-relaxed font-normal mb-14 max-w-2xl">
                Whether you have questions, feedback, <br /> drop us a message and we'll get back to you as soon as possible.
              </p>
            </motion.div>

            {/* Interactive Multi-Select Service Pills (Waitlist/Platform Preferences) */}
            <div className="mb-12">
              <h3 className="text-2xl font-mono font-medium tracking-tight text-white mb-2 uppercase">
                What sort of service?
              </h3>
              <p className="opacity-85 text-cyber-cyan font-mono text-sm mb-8">
                Select all that apply
              </p>

              <div className="flex flex-wrap gap-4 mb-8">
                {serviceOptions.map((service) => {
                  const isActive = selectedServices.includes(service);
                  return (
                    <motion.button
                      key={service}
                      onClick={() => handlePillClick(service)}
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      className={`px-6 py-3 font-mono tracking-wider text-sm border transition-all duration-200 flex items-center gap-2 rounded-full cursor-pointer ${isActive
                        ? 'bg-cyber-pink text-white border-cyber-pink shadow-lg shadow-cyber-pink/20'
                        : 'bg-cyber-dark/40 text-cyber-cyan border-cyber-cyan/30 hover:bg-cyber-cyan/10 hover:border-cyber-cyan'
                        }`}
                    >
                      <AnimatePresence>
                        {isActive && (
                          <motion.span
                            initial={{ scale: 0, width: 0 }}
                            animate={{ scale: 1, width: "auto" }}
                            exit={{ scale: 0, width: 0 }}
                            transition={{ type: "spring", stiffness: 300, damping: 20 }}
                          >
                            <Check className="w-4 h-4 text-white" />
                          </motion.span>
                        )}
                      </AnimatePresence>
                      {service}
                    </motion.button>
                  );
                })}
              </div>

              {/* Contingent Feedback Status Banner */}
              <div className="min-h-[60px]">
                <AnimatePresence mode="wait">
                  {selectedServices.length === 0 ? (
                    <motion.p
                      key="empty-state"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 0.5 }}
                      exit={{ opacity: 0 }}
                      className="italic text-xs font-mono text-neutral-400"
                    >
                      Please click to select services above.
                    </motion.p>
                  ) : (
                    <motion.div
                      key="active-state"
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ type: "spring", stiffness: 300, damping: 25 }}
                      className="bg-cyber-card/60 border border-cyber-purple/30 rounded-2xl p-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 w-full"
                    >
                      <div className="font-mono text-sm">
                        <span className="text-cyber-cyan">Ready to inquire about: </span>
                        <span className="text-white font-bold">{selectedServices.join(", ")}</span>
                      </div>

                      <button
                        onClick={() => alert(`Submitting inquiry for: ${selectedServices.join(', ')}`)}
                        className="text-cyber-pink font-mono text-xs uppercase tracking-widest font-semibold flex items-center gap-2 group cursor-pointer border border-cyber-pink/20 hover:border-cyber-pink px-4 py-2 hover:bg-cyber-pink/10 transition-all rounded-md"
                      >
                        Let's Go <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>

            {/* Email form to complete the Waitlist */}
            <div className="bg-cyber-card/30 border border-cyber-purple/20 p-6 sm:p-8 rounded-2xl backdrop-blur-sm mt-8">
              <h4 className="text-xl font-mono text-white mb-4 uppercase tracking-widest">// SECURE WAITLIST TERMINAL</h4>
              <form onSubmit={(e) => { e.preventDefault(); alert("Hacking channel established! You have been added to the waitlist."); }} className="flex flex-col sm:flex-row gap-4">
                <input
                  type="email"
                  required
                  placeholder="ENTER_YOUR_NEURAL_EMAIL@GRID.COM"
                  className="flex-1 bg-cyber-dark/80 border border-cyber-cyan/30 px-4 py-3 rounded font-mono text-cyber-cyan text-sm focus:outline-none focus:border-cyber-pink focus:ring-1 focus:ring-cyber-pink placeholder:text-cyber-cyan/30"
                />
                <button
                  type="submit"
                  className="px-6 py-3 bg-cyber-cyan text-cyber-dark font-mono uppercase font-bold tracking-widest hover:bg-cyber-pink hover:text-white transition-colors duration-300 shadow-[0_0_15px_rgba(0,240,255,0.3)] hover:shadow-[0_0_15px_rgba(255,0,127,0.5)]"
                >
                  SUBMIT_BREACH
                </button>
              </form>
            </div>

          </section>

        </main>

        {/* Footer Component */}
        <footer className="border-t border-cyber-purple/10 bg-cyber-dark/90 py-12 px-6">
          <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-4 gap-8">
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <span className="font-mono text-xl text-white tracking-widest font-bold neon-text-cyan">LAIZDEV</span>
                <span className="text-cyber-pink text-xs select-none">✸</span>
              </div>
              <p className="text-sm text-neutral-400 leading-relaxed font-sans">
                Made with Gemini for demonstration purposes only.
              </p>
              <div className="flex gap-4 text-neutral-400">
                <a href="https://github.com/Coinbr0x/chromabreach" target="_blank" rel="noreferrer" className="hover:text-cyber-pink transition-colors"><i className="fa-brands fa-github text-lg" /></a>
                <a href="#" className="hover:text-cyber-pink transition-colors"><i className="fa-brands fa-twitter text-lg" /></a>
                <a href="#" className="hover:text-cyber-pink transition-colors"><i className="fa-brands fa-youtube text-lg" /></a>
                <a href="#" className="hover:text-cyber-pink transition-colors"><i className="fa-brands fa-discord text-lg" /></a>
              </div>
            </div>
            <div>
              <h4 className="font-mono text-sm text-cyber-cyan uppercase tracking-widest mb-4">// PROJECTS</h4>
              <ul className="space-y-2 text-sm text-neutral-400">
                <li><a href="#" className="hover:text-white transition-colors font-mono">CHROMA BREACH</a></li>
                <li><a href="#" className="hover:text-white transition-colors font-mono font-semibold text-cyber-pink/80">GRID_BURNER [WIP]</a></li>
                <li><a href="#" className="hover:text-white transition-colors font-mono">SPECTRA.EXE</a></li>
              </ul>
            </div>
            <div>
              <h4 className="font-mono text-sm text-cyber-cyan uppercase tracking-widest mb-4">// STUDIO</h4>
              <ul className="space-y-2 text-sm text-neutral-400 font-sans">
                <li><a href="#" className="hover:text-white transition-colors">Labs</a></li>
                <li><a href="#" className="hover:text-white transition-colors">Studio</a></li>
                <li><a href="#" className="hover:text-white transition-colors">Openings</a></li>
                <li><a href="#" className="hover:text-white transition-colors">Shop</a></li>
              </ul>
            </div>
            <div>
              <h4 className="font-mono text-sm text-cyber-cyan uppercase tracking-widest mb-4">// STATUS</h4>
              <div className="space-y-2 font-mono text-xs text-neutral-400">
                <p className="flex justify-between"><span>MAINFRAME CORE:</span> <span className="text-cyber-green">ONLINE</span></p>
                <p className="flex justify-between"><span>GRID ENCRYPTION:</span> <span className="text-cyber-pink">BREACHED</span></p>
                <p className="flex justify-between"><span>CHROMA SPECTRUM:</span> <span className="text-cyber-cyan">98.4% SYNC</span></p>
              </div>
            </div>
          </div>
          <div className="max-w-7xl mx-auto mt-8 pt-8 border-t border-cyber-purple/5 text-center text-xs text-neutral-500 font-mono">
            <p>&copy; 2026 MAINFRAME. Chroma Breach and all related assets are trademarks of Mainframe Studio. All rights reserved.</p>
          </div>
        </footer>
      </div>

    </div>
  );
}
