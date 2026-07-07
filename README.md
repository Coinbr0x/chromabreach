# Chroma Breach Landing Page

A premium, high-performance landing page for **Chroma Breach**, a cyberpunk indie roguelite action game.

The website features a highly optimized, scroll-scrubbed background animation that syncs perfectly with the user's scroll depth. To guarantee 60fps performance on desktop browsers, the background video is pre-downloaded as an in-memory blob and sliced into frame-by-frame `ImageBitmap` representations rendered to an HTML5 Canvas, bypassing standard browser video-seeking latency completely. On mobile devices, it gracefully degrades to skip the extraction overhead entirely.

## 🚀 Tech Stack

- **Frontend Core:** React, HTML5 Canvas, JavaScript (ES6+)
- **Build Tool:** Vite
- **Styling:** TailwindCSS, CSS Variables
- **Animations:** Framer Motion (custom loading screen, transitions)
- **Icons:** Lucide React
- **Deployment:** Firebase Hosting

## 🛠️ Optimizations

- **Canvas Frame Extraction:** Pre-extracts 60 frames into RAM for lag-free scroll scrubbing.
- **Loading Overlay:** Smart SVG loading indicator tracking both asset download progress and frame decoding status.
- **Mobile Check:** Skips video extraction on mobile devices to preserve bandwidth, battery, and rendering performance.
- **All-Keyframe Encoding:** Custom H.264 video encoding where every frame is an IDR-frame (Intra-coded), reducing random-access decoding latency.
