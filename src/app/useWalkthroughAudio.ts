"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { NARRATION_SRC, isSpeakingAt } from "./walkthroughNarration";

// ─────────────────────────────────────────────────────────────────────
//  Walkthrough audio — narration playback + ambient music bed
//
//  Two sources, one clock:
//
//  * Narration is a single 90s mp3 that is *slaved* to the walkthrough's
//    existing elapsed-time clock. The clock stays the master; this hook
//    only ever seeks the audio element to match it. That is what keeps
//    captions (derived from the same clock) honest — they can never drift
//    from the voice, because neither is driving the other.
//
//  * Music is synthesised in the Web Audio API rather than loaded from a
//    file: a slow filtered pad. That keeps the page asset-light, loops
//    seamlessly for as long as the walkthrough does, sidesteps stock-music
//    licensing entirely, and — the practical reason — makes ducking and
//    fades exact, because they are gain automation rather than a second
//    decoded stream to wrestle with.
//
//  Autoplay policy: no browser will play audible sound before a user
//  gesture, and the walkthrough autoplays in the hero. So audio starts
//  OFF and the AudioContext is not even constructed until the visitor
//  presses the sound button. Muted playback is the default experience;
//  captions carry the narration for everyone who never presses it.
// ─────────────────────────────────────────────────────────────────────

/** Music bed level — the brief's 15–20%, at the quiet end of it. */
const MUSIC_GAIN = 0.17;

/** How far the bed drops under narration (to ~5% absolute). */
const DUCK_FACTOR = 0.3;

/** Music fade in at the top of the loop / out at the end, ms. */
const FADE_IN_MS = 2500;
const FADE_OUT_MS = 3000;

/** Resync the narration if it drifts further than this from the clock. */
const MAX_DRIFT_MS = 250;

/**
 * A major-9 voicing, low and open. Two oscillators per note, detuned a
 * few cents apart, is what turns a chord into a pad — the slow beating
 * between them is the movement.
 */
const PAD_NOTES = [110.0, 164.81, 220.0, 277.18, 329.63];

interface MusicGraph {
  ctx: AudioContext;
  master: GainNode;
  stop: () => void;
}

function buildMusic(ctx: AudioContext): MusicGraph {
  const master = ctx.createGain();
  master.gain.value = 0;
  master.connect(ctx.destination);

  // Rolls the top off the pad so it sits behind a voice instead of
  // competing with it. The LFO below opens and closes it very slowly.
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 780;
  filter.Q.value = 0.6;
  filter.connect(master);

  // A little space, so the pad doesn't sound like a synth chord held down.
  const delay = ctx.createDelay(1);
  delay.delayTime.value = 0.42;
  const feedback = ctx.createGain();
  feedback.gain.value = 0.28;
  const wet = ctx.createGain();
  wet.gain.value = 0.35;
  delay.connect(feedback);
  feedback.connect(delay);
  delay.connect(wet);
  wet.connect(master);
  filter.connect(delay);

  const nodes: (OscillatorNode | GainNode)[] = [];

  PAD_NOTES.forEach((freq, i) => {
    const voice = ctx.createGain();
    // Roll off the upper voices so the chord reads as one warm block
    // rather than five separate tones.
    voice.gain.value = 0.34 / (1 + i * 0.55);
    voice.connect(filter);

    for (const detune of [-6, 6]) {
      const osc = ctx.createOscillator();
      osc.type = i === 0 ? "triangle" : "sine";
      osc.frequency.value = freq;
      osc.detune.value = detune;
      osc.connect(voice);
      osc.start();
      nodes.push(osc);
    }

    // Each voice breathes at its own rate, so the pad never lands on a
    // repeating pulse the ear can latch onto.
    const trem = ctx.createOscillator();
    trem.frequency.value = 0.035 + i * 0.017;
    const tremDepth = ctx.createGain();
    tremDepth.gain.value = voice.gain.value * 0.4;
    trem.connect(tremDepth);
    tremDepth.connect(voice.gain);
    trem.start();
    nodes.push(trem, tremDepth);
  });

  // Slow filter sweep — the one obvious "modern ambient" gesture.
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 0.05;
  const lfoDepth = ctx.createGain();
  lfoDepth.gain.value = 260;
  lfo.connect(lfoDepth);
  lfoDepth.connect(filter.frequency);
  lfo.start();
  nodes.push(lfo, lfoDepth);

  return {
    ctx,
    master,
    stop: () => {
      for (const n of nodes) {
        if ("stop" in n) {
          try {
            n.stop();
          } catch {
            /* already stopped */
          }
        }
        n.disconnect();
      }
      master.disconnect();
      filter.disconnect();
      delay.disconnect();
      feedback.disconnect();
      wet.disconnect();
    },
  };
}

/**
 * HeroDemo mounts the walkthrough twice — once in the hero preview and
 * again inside the "watch the demo" modal — and both keep running. Only
 * one of them may be audible, so enabling sound anywhere mutes everywhere
 * else.
 */
const audibleInstances = new Set<(on: boolean) => void>();

interface Options {
  /** Walkthrough clock position, ms. */
  elapsed: number;
  /** Total loop length, ms — the narration track is exactly this long. */
  totalMs: number;
  /** False while the walkthrough is paused (offscreen / reduced motion). */
  running: boolean;
}

export function useWalkthroughAudio({ elapsed, totalMs, running }: Options) {
  const [enabled, setEnabled] = useState(false);
  const [narrationFailed, setNarrationFailed] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const musicRef = useRef<MusicGraph | null>(null);

  // Read the clock from a ref inside callbacks so enabling audio doesn't
  // have to wait for the next tick to seek to the right place.
  const elapsedRef = useRef(elapsed);
  // Declared before the effects that read it, so it is already current by
  // the time the enable effect below runs in the same commit.
  useEffect(() => {
    elapsedRef.current = elapsed;
  });

  const enabledRef = useRef(enabled);
  const selfRef = useRef<(on: boolean) => void>(() => {});
  useEffect(() => {
    enabledRef.current = enabled;
  });

  useEffect(() => {
    const mute = (on: boolean) => setEnabled(on);
    selfRef.current = mute;
    audibleInstances.add(mute);
    return () => {
      audibleInstances.delete(mute);
    };
  }, []);

  const toggle = useCallback(() => {
    const next = !enabledRef.current;
    if (next) {
      for (const other of audibleInstances) {
        if (other !== selfRef.current) other(false);
      }
    }
    setEnabled(next);
  }, []);

  // Build the graph on first enable — inside the click handler's task, so
  // the AudioContext is created against a real user gesture.
  useEffect(() => {
    if (!enabled) return;

    if (!musicRef.current) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (Ctor) musicRef.current = buildMusic(new Ctor());
    }
    void musicRef.current?.ctx.resume();

    if (!audioRef.current) {
      const el = new Audio(NARRATION_SRC);
      el.preload = "auto";
      el.loop = true;
      // The mp3 is mixed at final level; the bed ducks around it rather
      // than the voice being pushed over the top of the music.
      el.volume = 1;
      el.addEventListener("error", () => setNarrationFailed(true));
      audioRef.current = el;
    }

    const el = audioRef.current;
    el.currentTime = (elapsedRef.current % totalMs) / 1000;
    void el.play().catch(() => setNarrationFailed(true));
  }, [enabled, totalMs]);

  // Silence everything the moment audio is switched off or the
  // walkthrough pauses, without tearing the graph down.
  useEffect(() => {
    const live = enabled && running;
    const el = audioRef.current;
    const music = musicRef.current;

    if (!live) {
      el?.pause();
      if (music) {
        music.master.gain.cancelScheduledValues(music.ctx.currentTime);
        music.master.gain.setTargetAtTime(0, music.ctx.currentTime, 0.15);
      }
      return;
    }
    if (el && el.paused) void el.play().catch(() => setNarrationFailed(true));
  }, [enabled, running]);

  // Per-tick: hold the narration against the clock, and drive the bed's
  // gain from fade envelope × duck state.
  useEffect(() => {
    if (!enabled || !running) return;

    const el = audioRef.current;
    if (el && !el.paused && !narrationFailed) {
      const drift = Math.abs(el.currentTime * 1000 - elapsed);
      // The loop point is the one place a large "drift" is expected —
      // one side has wrapped and the other hasn't yet.
      if (drift > MAX_DRIFT_MS && drift < totalMs - MAX_DRIFT_MS) {
        el.currentTime = elapsed / 1000;
      }
    }

    const music = musicRef.current;
    if (!music) return;

    const fadeIn = Math.min(1, elapsed / FADE_IN_MS);
    const fadeOut = Math.min(1, (totalMs - elapsed) / FADE_OUT_MS);
    const duck = isSpeakingAt(elapsed) ? DUCK_FACTOR : 1;
    const target = MUSIC_GAIN * Math.min(fadeIn, fadeOut) * duck;

    // Ducking down is quicker than coming back up, which is how a
    // broadcast ducker behaves: get out of the way promptly, return
    // gently enough that the listener doesn't notice the lift.
    const tc = duck < 1 ? 0.12 : 0.4;
    music.master.gain.setTargetAtTime(target, music.ctx.currentTime, tc);
  }, [elapsed, enabled, running, totalMs, narrationFailed]);

  useEffect(() => {
    return () => {
      audioRef.current?.pause();
      audioRef.current = null;
      musicRef.current?.stop();
      void musicRef.current?.ctx.close();
      musicRef.current = null;
    };
  }, []);

  return { enabled, toggle, narrationFailed };
}
