import type { SubtitleSegment, Video } from "@/lib/domain/types";

export const mockVideos: Video[] = [
  {
    id: "demo-1",
    title: "How to communicate clearly at work",
    cover_url:
      "https://images.unsplash.com/photo-1521737604893-d14cc237f11d?auto=format&fit=crop&w=1200&q=80",
    video_url: "https://www.w3schools.com/html/mov_bbb.mp4",
    author: "Demo Creator",
    level: "★★☆☆☆",
    category: "Career",
    duration_sec: 596,
    published_at: new Date().toISOString(),
    description:
      "A short clip to demo SpeakEcho's interactive subtitles. Click a sentence to jump, click a word to lookup and save.",
  },
];

export const mockSubtitles: Record<string, SubtitleSegment[]> = {
  "demo-1": [
    {
      start: 0.5,
      end: 3.2,
      text: "Clear communication makes work easier.",
      zh: "清晰的沟通会让工作更容易。",
      words: [
        { w: "Clear", s: 0.5, e: 0.85, level: "cet4" },
        { w: "communication", s: 0.9, e: 1.6, level: "cet6" },
        { w: "makes", s: 1.65, e: 1.9, level: "cet4" },
        { w: "work", s: 1.95, e: 2.15, level: "cet4" },
        { w: "easier", s: 2.2, e: 2.6, level: "ielts" },
      ],
    },
    {
      start: 3.3,
      end: 6.8,
      text: "Focus on intent, not just words.",
      zh: "把注意力放在意图上，而不只是字面表达。",
      words: [
        { w: "Focus", s: 3.3, e: 3.65, level: "cet4" },
        { w: "on", s: 3.7, e: 3.78, level: "basic" },
        { w: "intent", s: 3.8, e: 4.2, level: "ielts" },
        { w: "not", s: 4.25, e: 4.4, level: "basic" },
        { w: "just", s: 4.45, e: 4.65, level: "basic" },
        { w: "words", s: 4.7, e: 5.1, level: "cet4" },
      ],
    },
  ],
};

