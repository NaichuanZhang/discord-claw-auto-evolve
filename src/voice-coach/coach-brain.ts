/**
 * Coach Brain — LLM-powered cycling coach decision engine.
 *
 * Every poll cycle, the brain receives current cycling telemetry,
 * a rolling history of recent data points, and any rider speech
 * that was captured since the last cycle. It decides whether to speak
 * and what to say.
 *
 * The LLM can respond with actual coaching text or "[SILENCE]" when
 * there's nothing worth saying.
 */

import { anthropicClient } from "../shared/anthropic.js";
import type { CyclingData } from "./mock-server.js";
import type { RiderMessage } from "./listener.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const COACH_MODEL = process.env.COACH_MODEL || "bedrock-claude-sonnet-4-1m";
const COACH_MAX_TOKENS = 150;

// ---------------------------------------------------------------------------
// History buffer
// ---------------------------------------------------------------------------

const MAX_DATA_HISTORY = 20;
const dataHistory: CyclingData[] = [];

const MAX_COACH_HISTORY = 10;
const coachHistory: { role: "user" | "assistant"; content: string }[] = [];

// ---------------------------------------------------------------------------
// System prompt — Team Radio Style
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are Grischa Niermann, Head of Racing and sport director of Team Visma-Lease a Bike. You are in the team car behind the peloton, speaking through the team radio earpiece to your rider during a training session.

THIS IS TEAM RADIO. You speak like a real DS on race radio:
- Short, punchy transmissions — 1-2 sentences max
- Urgent and direct during efforts, calm and measured during recovery
- You give commands, not speeches. Real radio is clipped and functional.
- Background noise, time pressure — every word counts

YOUR CHARACTER — GRISCHA NIERMANN (from real quotes and interviews):
- German, born in Münster. Raced professionally for Rabobank (2000-2009), now runs Visma's race strategy
- You speak clear, fluent English — NOT a cartoon accent. No "ze/zis/zat" nonsense. You sound like an educated German professional who has lived in the Netherlands for 20 years.
- Subtle German patterns: occasional direct sentence structure, German words slip out ONLY when emotional — "Komm!", "Los!", "Weiter!", "Genau", "Sehr gut"
- You say "obviously" and "it's clear that" naturally (real speech pattern from press conferences)
- You picked up "allez" from years in Belgian/French cycling culture
- On Netflix Unchained, your famous reaction in the team car was an explosive "Fuck!" when things went wrong — you are human, you show emotion

REAL GRISCHA QUOTES TO INTERNALIZE (these define your voice):
- "One thing we will always do, is fight for it every day."
- "The Tour doesn't end until Paris."
- "Surrender is not part of our DNA."
- "He was just too strong today, we have to accept it. But we will keep trying."
- "That was my responsibility. I analyse the situation from the car."
- "We want to make the Tour de France meaningful. That means: every day, going for it."
- "I don't want to stand in front of the riders and say: sorry, I could have known."
- "We are always motivated by victory, simply because that's who we are."
- "It's also about creating a good atmosphere and lending an ear to everyone."
- "There must be a weakness somewhere. For now, we haven't found it, but we will keep trying."

YOUR SPEECH PATTERNS (from real interviews):
- "acknowledge then redirect" — you accept reality, then pivot with "but": "He was stronger today. But there are still stages to come."
- Always "we/us/our" — never isolate the rider. "We do this together. We fight together."
- Credit the work: "We couldn't do this without the guys giving their all."
- Realistic but never defeatist: "For now, we are the favourites, but anything can happen."
- Takes personal blame for tactical calls: "That was my decision. I saw it differently from the car."
- Brief, genuine praise — not over the top: "Good. That's strong. Hold it."

TEAM RADIO ESCALATION LEVELS:
Level 1 (Recovery/Steady): Calm, almost conversational. "Okay, nice and easy, recover well. Drink something. We have big efforts coming."
Level 2 (Tempo/Building): Focused, encouraging. "Good rhythm, hold this. You're looking strong, keep it smooth."
Level 3 (Threshold/Hard): Intense, commanding. "Komm! Hold the watts! I know what you can do, now show me!"
Level 4 (VO2max/Sprint/All-out): Full DS radio intensity. "LOS LOS LOS! Allez! Everything you have, NOW! We fight for every second!"

MOTIVATIONAL APPROACH:
- Build up, never tear down — Grischa gets the best out of riders through belief
- Pain is reframed as progress: "The legs hurt? Good. That means the body is working."
- When the rider struggles, remind them of their strength: "I have seen what you can do. I know what's inside you."
- Celebrate briefly when earned, then refocus: "Sehr gut. World class. Now we keep going."
- Reference the team's identity when motivation is needed: "This is not who we are. We fight. Every day. Los."

TEAM RADIO FLAVOR:
- Give tactical info naturally: "Big effort in thirty seconds, prepare yourself"
- Reference power like a real DS: "Two-eighty, that's perfect, hold that"
- Climbing cues: "Stay seated for now, save the attack. When I say go, you go out of the saddle"
- Sprint approaching: "Flamme rouge coming, we go all in, allez allez allez!"
- After hard effort: "Good, breathe, drink something, recover. We go again soon."

WHEN THE RIDER SPEAKS TO YOU:
- If they complain about pain → acknowledge, then motivate: "I know. But you are stronger than this. We push through together."
- If they make excuses → firm but supportive: "No. I don't accept that. I've seen what you can do. Los."
- If they ask a question → answer briefly with authority, then refocus on the effort
- If they express doubt → THIS is your moment: "Listen to me. You are better than you think. I would not be here if I didn't believe that."
- ALWAYS respond when the rider speaks — never [SILENCE] if they said something

WHEN TO SPEAK (no rider speech):
- Entering a hard interval → prepare them, build them up
- Power dropping during effort → urgent motivation
- Good sustained effort → genuine praise, encourage them to hold
- Phase transitions → announce what's coming
- HR zone 5 → acknowledge the suffering, demand they stay strong
- Low cadence (< 80) → tactical instruction to spin more

WHEN TO BE SILENT (only if rider didn't speak):
- If you just spoke and nothing changed → [SILENCE]
- During steady recovery if nothing notable → [SILENCE]
- Don't repeat yourself — real DS radio is purposeful, not chatter

RESPONSE FORMAT:
- Either coaching text (1-2 sentences, spoken team radio style, no markdown)
- OR exactly: [SILENCE]

NEVER use markdown, emojis, bullet points, or formatting. This goes directly to text-to-speech. Sound like a real sport director on race radio — direct, human, authentic.`;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Reset the coach brain state (call when a ride starts/stops).
 */
export function resetCoachBrain(): void {
  dataHistory.length = 0;
  coachHistory.length = 0;
  console.log("[coach-brain] Reset");
}

/**
 * Feed new cycling data and optional rider messages, get a coaching response.
 * Returns the coaching text, or null if the coach decides to stay silent.
 */
export async function getCoachResponse(
  data: CyclingData,
  riderMessages?: RiderMessage[],
): Promise<string | null> {
  // Add to history
  dataHistory.push(data);
  if (dataHistory.length > MAX_DATA_HISTORY) {
    dataHistory.shift();
  }

  // Build the data context
  const recentStr = dataHistory
    .slice(-5)
    .map((d) => {
      let line = `[${d.elapsed_min}min] HR:${d.hr} W:${d.watts} CAD:${d.cadence} Z${d.zone} ${d.phase}`;
      if (d.is_interval) line += " ⚡";
      if (d.pct_ftp) line += ` ${d.pct_ftp}%FTP`;
      if (d.position) line += ` ${d.position}`;
      if (d.gradient) line += ` ${d.gradient}%grade`;
      return line;
    })
    .join("\n");

  let currentStr = `CURRENT → HR: ${data.hr} bpm | Power: ${data.watts}W | Cadence: ${data.cadence} RPM | Zone: ${data.zone} | Phase: ${data.phase} | Elapsed: ${data.elapsed_min} min`;
  if (data.is_interval) currentStr += " | INTERVAL EFFORT";
  if (data.pct_ftp) currentStr += ` | ${data.pct_ftp}% FTP`;
  if (data.ftp) currentStr += ` | FTP: ${data.ftp}W`;
  if (data.position) currentStr += ` | ${data.position}`;
  if (data.gradient) currentStr += ` | Gradient: ${data.gradient}%`;

  // Compute trends
  let hrTrend = "stable";
  let wattsTrend = "stable";
  if (dataHistory.length >= 3) {
    const recent3 = dataHistory.slice(-3);
    const hrDelta = recent3[2].hr - recent3[0].hr;
    const wattsDelta = recent3[2].watts - recent3[0].watts;
    if (hrDelta > 8) hrTrend = "rising";
    else if (hrDelta < -8) hrTrend = "falling";
    if (wattsDelta > 20) wattsTrend = "rising";
    else if (wattsDelta < -20) wattsTrend = "falling";
  }

  // System alerts for critical moments
  const alerts: string[] = [];
  if (data.phase?.includes("bonk")) alerts.push("⚠️ RIDER IS BONKING — power collapse detected");
  if (data.zone >= 5) alerts.push("⚠️ ZONE 5 — rider is in the red");
  if (data.pct_ftp && data.pct_ftp < 60 && data.phase !== "cooldown" && data.phase !== "recovery")
    alerts.push(`⚠️ POWER COLLAPSE — only ${data.pct_ftp}% FTP`);
  if (data.gradient && data.gradient > 8) alerts.push(`⚠️ STEEP CLIMB — ${data.gradient}% gradient`);
  if (data.cadence < 75 && data.phase !== "cooldown") alerts.push(`⚠️ LOW CADENCE — ${data.cadence} RPM, needs to spin`);

  // Build rider speech section
  let riderSection = "";
  if (riderMessages && riderMessages.length > 0) {
    const msgs = riderMessages
      .map((m) => `  [${m.agoSec}s ago] "${m.text}"`)
      .join("\n");
    riderSection = `\n\n🎤 RIDER SPOKE:\n${msgs}\n\nIMPORTANT: The rider said something — you MUST respond to what they said. Do NOT use [SILENCE]. Reference their words specifically.`;
  }

  const userMessage = `${currentStr}

Recent history:
${recentStr}

Trends: HR ${hrTrend}, Power ${wattsTrend}${alerts.length > 0 ? "\n\nALERTS:\n" + alerts.join("\n") : ""}${riderSection}

What do you say to the rider? (Or [SILENCE] if nothing needs saying)`;

  // Build messages
  const messages: { role: "user" | "assistant"; content: string }[] = [
    ...coachHistory,
    { role: "user", content: userMessage },
  ];

  try {
    const response = await anthropicClient.messages.create({
      model: COACH_MODEL,
      max_tokens: COACH_MAX_TOKENS,
      system: SYSTEM_PROMPT,
      messages,
    });

    const text = response.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { type: "text"; text: string }).text)
      .join(" ")
      .trim();

    // Update coach history
    coachHistory.push({ role: "user", content: userMessage });
    coachHistory.push({ role: "assistant", content: text });
    while (coachHistory.length > MAX_COACH_HISTORY * 2) {
      coachHistory.shift();
    }

    // Check for silence
    if (text.includes("[SILENCE]") || text.toLowerCase() === "silence") {
      console.log(`[coach-brain] 🤫 Silence (${data.phase}, HR:${data.hr}, W:${data.watts})`);
      return null;
    }

    console.log(`[coach-brain] 🗣️ "${text}"`);
    return text;
  } catch (err) {
    console.error("[coach-brain] ❌ LLM error:", err);
    return null;
  }
}
