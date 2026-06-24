
class AudioService {
  private synthesis: SpeechSynthesis;
  private lastSpeakTime: number = 0;
  private minInterval: number = 3000; // Minimum 3 seconds between alerts
  private audioCtx: AudioContext | null = null; // Global Singleton Context
  private keepAliveSource: AudioBufferSourceNode | null = null;

  constructor() {
    this.synthesis = window.speechSynthesis;
  }

  speak(text: string, priority: boolean = false) {
    if (!this.synthesis) {
      console.warn("Speech synthesis not supported");
      return;
    }

    const now = Date.now();
    if (!priority && now - this.lastSpeakTime < this.minInterval) {
      return; // Debounce normal messages
    }

    // Cancel current if priority
    if (priority) {
      this.synthesis.cancel();
    }

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'zh-CN';
    utterance.rate = 1.1; // Slightly faster
    utterance.pitch = 1.0;
    
    // Attempt to select a Chinese voice
    const voices = this.synthesis.getVoices();
    const zhVoice = voices.find(v => v.lang.includes('zh') || v.lang.includes('CN'));
    if (zhVoice) {
      utterance.voice = zhVoice;
    }

    this.synthesis.speak(utterance);
    this.lastSpeakTime = now;
  }

  /**
   * Get or Create Single Audio Context
   */
  private getContext(): AudioContext {
      if (!this.audioCtx) {
          const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
          this.audioCtx = new AudioContext();
      }
      if (this.audioCtx.state === 'suspended') {
          this.audioCtx.resume().catch(e => console.warn("Audio Resume Failed", e));
      }
      return this.audioCtx;
  }

  /**
   * Plays a crisp "Ding" sound (Synthesized) to alert user.
   * High pitch sine wave + metallic overtone.
   * OPTIMIZED: Reuses context to prevent memory leak crash.
   */
  playAlert() {
    try {
        const ctx = this.getContext();
        const t = ctx.currentTime;
        
        // Oscillator 1: High Ping (Primary)
        const osc1 = ctx.createOscillator();
        const gain1 = ctx.createGain();
        osc1.type = 'sine';
        osc1.frequency.setValueAtTime(1200, t);
        osc1.frequency.exponentialRampToValueAtTime(100, t + 0.6);
        
        gain1.gain.setValueAtTime(0.3, t);
        gain1.gain.exponentialRampToValueAtTime(0.01, t + 0.6);
        
        osc1.connect(gain1);
        gain1.connect(ctx.destination);
        osc1.start(t);
        osc1.stop(t + 0.6);

        // Oscillator 2: Metallic Click (Attack)
        const osc2 = ctx.createOscillator();
        const gain2 = ctx.createGain();
        osc2.type = 'triangle';
        osc2.frequency.setValueAtTime(3000, t);
        
        gain2.gain.setValueAtTime(0.1, t);
        gain2.gain.exponentialRampToValueAtTime(0.01, t + 0.1);
        
        osc2.connect(gain2);
        gain2.connect(ctx.destination);
        osc2.start(t);
        osc2.stop(t + 0.1);

    } catch (e) {
        console.warn("Alert sound failed", e);
    }
  }

  /**
   * Sends a system-level notification (Popup).
   * Works even if browser is minimized.
   */
  sendNotification(title: string, body: string) {
      if (!("Notification" in window)) return;

      const spawn = () => {
          try {
              new Notification(title, { 
                  body, 
                  requireInteraction: true, // Keeps it on screen until user clicks
                  tag: 'trade_alert' // Prevent spamming, replace old alert
              });
          } catch (e) {
              console.error("Notification spawn error", e);
          }
      };

      if (Notification.permission === "granted") {
          spawn();
      } else if (Notification.permission !== "denied") {
          Notification.requestPermission().then(permission => {
              if (permission === "granted") spawn();
          });
      }
  }

  /**
   * Starts a silent infinite audio loop.
   * This tricks the browser into thinking the user is consuming media,
   * preventing the tab from being throttled or frozen in the background.
   */
  enableBackgroundMode() {
    try {
        const ctx = this.getContext();

        // If source already exists and is running, do nothing
        if (this.keepAliveSource) return;

        // Create a silent buffer (1 second)
        const buffer = ctx.createBuffer(1, 44100, 44100);
        const channelData = buffer.getChannelData(0);
        for (let i = 0; i < 44100; i++) channelData[i] = 0; // Silence

        // Create source and loop it
        this.keepAliveSource = ctx.createBufferSource();
        this.keepAliveSource.buffer = buffer;
        this.keepAliveSource.loop = true;
        
        // Connect to destination (it's silent anyway)
        this.keepAliveSource.connect(ctx.destination);
        this.keepAliveSource.start();
        
        console.log("🔊 Background Audio Keep-Alive Enabled (Silent)");
    } catch (e) {
        console.warn("Failed to enable background audio", e);
    }
  }

  /**
   * Checks if the audio context is suspended and tries to wake it up.
   * Should be called periodically by the main loop.
   */
  async checkAndResume() {
      if (this.audioCtx && this.audioCtx.state === 'suspended') {
          try {
              await this.audioCtx.resume();
          } catch (e) {
              console.warn("Audio Resume Failed", e);
          }
      }
  }
}

export const audioService = new AudioService();
