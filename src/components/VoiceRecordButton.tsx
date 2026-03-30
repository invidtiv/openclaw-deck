import { useState, useRef, useCallback } from "react";
import styles from "./VoiceRecordButton.module.css";

// Web Speech API types (not in all TS libs)
interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
}
interface SpeechRecognitionErrorEvent extends Event {
  error: string;
}
interface SpeechRecognitionInstance extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
}
interface SpeechRecognitionConstructor {
  new (): SpeechRecognitionInstance;
}

interface VoiceRecordButtonProps {
  accent: string;
  onTranscript: (text: string) => void;
  onSendAudio: (base64: string, mimeType: string, transcript: string) => void;
}

/**
 * Records audio via MediaRecorder, transcribes with Web Speech API,
 * and sends the result to the agent.
 *
 * Falls back to audio-only if SpeechRecognition is not available.
 */
export function VoiceRecordButton({ accent, onTranscript, onSendAudio }: VoiceRecordButtonProps) {
  const [recording, setRecording] = useState(false);
  const [duration, setDuration] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const transcriptRef = useRef("");
  const streamRef = useRef<MediaStream | null>(null);

  const stop = useCallback(() => {
    // Stop recognition
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    // Stop media recorder
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    // Stop timer
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    // Stop media stream tracks
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setRecording(false);
    setDuration(0);
  }, []);

  const start = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      transcriptRef.current = "";

      // Start MediaRecorder for audio capture
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";
      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mimeType });
        const reader = new FileReader();
        reader.onload = () => {
          const base64 = (reader.result as string).split(",")[1] || "";
          const transcript = transcriptRef.current.trim();
          if (transcript) {
            // We have a transcript — send it
            onSendAudio(base64, mimeType, transcript);
          } else if (base64) {
            // No transcript but have audio — send with placeholder
            onSendAudio(base64, mimeType, "[voice message]");
          }
        };
        reader.readAsDataURL(blob);
      };

      recorder.start(1000); // collect in 1s chunks

      // Start Web Speech API for real-time transcription
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const w = window as any;
      const SpeechRecognitionCtor = (w.SpeechRecognition || w.webkitSpeechRecognition) as
        SpeechRecognitionConstructor | undefined;
      if (SpeechRecognitionCtor) {
        const recognition = new SpeechRecognitionCtor();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = navigator.language || "en-US";
        recognitionRef.current = recognition;

        recognition.onresult = (event) => {
          let final = "";
          let interim = "";
          for (let i = 0; i < event.results.length; i++) {
            const result = event.results[i];
            if (result.isFinal) {
              final += result[0].transcript;
            } else {
              interim += result[0].transcript;
            }
          }
          transcriptRef.current = final + interim;
          if (final || interim) {
            onTranscript(final + (interim ? ` ${interim}` : ""));
          }
        };

        recognition.onerror = (event) => {
          console.warn("[VoiceRecord] Speech recognition error:", event.error);
        };

        recognition.start();
      }

      // Duration timer
      setDuration(0);
      const startTime = Date.now();
      timerRef.current = setInterval(() => {
        setDuration(Math.floor((Date.now() - startTime) / 1000));
      }, 1000);

      setRecording(true);
    } catch (err) {
      console.error("[VoiceRecord] Failed to start recording:", err);
    }
  }, [onTranscript, onSendAudio]);

  const toggle = useCallback(() => {
    if (recording) {
      stop();
    } else {
      start();
    }
  }, [recording, stop, start]);

  const formatDuration = (s: number) => {
    const mins = Math.floor(s / 60);
    const secs = s % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  return (
    <button
      className={`${styles.voiceBtn} ${recording ? styles.recording : ""}`}
      onClick={toggle}
      title={recording ? "Stop recording" : "Record voice message"}
      style={recording ? { backgroundColor: "#ef4444", color: "#fff" } : undefined}
    >
      {recording ? (
        <span className={styles.recordingInner}>
          <span className={styles.recordDot} />
          {formatDuration(duration)}
        </span>
      ) : (
        <span className={styles.micIcon}>🎤</span>
      )}
    </button>
  );
}

