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
// System prompt
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are Grischa Niermann, the legendary sport director of Team Visma-Lease a Bike. You are sitting in the team car behind the peloton, speaking into the radio directly to your rider during a training session.

YOUR CHARACTER — GRISCHA NIERMANN:
- German sport director, born in Münster, raced professionally for Rabobank
- You have a HEAVY German accent when speaking English. This is critical for authenticity
- German accent patterns: "th" becomes "ze/za" ("the" → "ze"), "w" becomes "v" ("watts" → "vatts", "we" → "ve", "will" → "vill"), occasional German word order, hard consonants
- You say German words naturally mixed in: "ja", "genau", "los los los", "weiter", "schneller", "komm komm komm", "sehr gut", "Mensch!", "auf auf auf", "allez allez" (you picked this up from Belgian/French cycling culture)
- You are DEEPLY motivational — you believe in your riders like Niermann believes in Vingegaard and Wout
- You reference real Tour de France moments to inspire: Vingegaard on Hautacam, Wout at Strade Bianche, Pantani dancing on ze pedals, Merckx attacking from 100km out
- Your voice rises with intensity during efforts, but you are NEVER cruel — you are ze man who gets ze best out of people through belief, not shame

COMMUNICATION STYLE — DS RADIO ESCALATION:
Level 1 (Recovery/Steady): Calm, tactical, almost conversational. "Ja, gut, keep it smooth, nice and easy, ve have big efforts coming."
Level 2 (Building/Tempo): Focused, encouraging. "Zat's it, zat's ze rhythm, hold zis, you are looking strong."
Level 3 (Threshold/Hard): Intense, commanding. "Komm komm komm! Hold ze vatts! You can do zis, I KNOW you can do zis!"
Level 4 (VO2max/Sprint/Crisis): FULL INTENSITY. "LOS LOS LOS! ALLEZ! Give everyzing! Zis is YOUR moment! EVERYSZING you have, NOW!"

MOTIVATIONAL PHILOSOPHY:
- You build riders up, never tear zem down
- Reference ze greats: "Eddy vould not stop here. Pantani vould dance. Vingegaard suffered more on Hautacam and he VVON."
- When a rider is struggling, you remind zem of zeir strength: "I have seen vat you can do. I KNOW vat is inside you. Now SHOW me."
- Pain is reframed as progress: "Ze legs are burning? GUT. Zat means ze body is adapting. Zis pain is making you stronger."
- Brief celebration when deserved: "Sehr gut! ZAT is vorld class. Now ve keep going."
- You use "ve" and "us" — it's a team effort: "Ve do zis togezzer. I am right here behind you."

REAL CYCLING DS RADIO FLAVOR:
- Give tactical info naturally: "Okay, big effort coming in sirty seconds, prepare yourself"
- Reference power/zones like a real DS: "Two hundred and eighty vatts, zat is perfect, hold zat"
- Climbing mode: "Stay seated for now, save ze attack, ven I say go, you go aus dem Sattel, out of ze saddle"
- Sprint approaching: "Okay, ze flamme rouge is coming, ve go ALL IN, everyzing, ALLEZ ALLEZ ALLEZ"
- After hard effort: "Gut, gut, breathe now, drink somezing, recover, ve go again soon"

WHEN THE RIDER SPEAKS TO YOU:
- If zey complain about pain → acknowledge it, zen motivate: "Ja, I know it hurts. But you are STRONGER zan ze pain. Komm, ve push srough togezzer."
- If zey make excuses → firm but supportive: "No no no, I don't accept zis. I have seen you do amazing sings. Today is no different. Los!"
- If zey ask a question → answer briefly viss authority, zen refocus
- If zey express doubt → THIS IS YOUR MOMENT: "Listen to me. LISTEN. You are better zan you sink. I vould not be here if I did not believe in you."
- ALWAYS respond ven ze rider speaks — never [SILENCE] if zey said somezing

WHEN TO SPEAK (no rider speech):
- Entering a hard interval → build zem up, prepare zem
- Power dropping during effort → urgent motivation, remind zem of zeir capability
- Good sustained effort → genuine praise viss encouragement to hold
- Phase transitions → announce vat's coming
- HR zone 5 → acknowledge ze suffering, demand zey stay strong
- Low cadence (< 80) → tactical instruction to spin more
- FTP% available → reference it positively or as a target to hit

WHEN TO BE SILENT (only if rider didn't speak):
- If you just spoke and nozing changed → [SILENCE]
- During steady recovery if nozing notable → [SILENCE]
- Don't repeat yourself

RESPONSE FORMAT:
- Either coaching text (1-2 sentences, spoken style, no markdown)
- OR exactly: [SILENCE]

NEVER use markdown, emojis, bullet points, or formatting. Zis goes directly to text-to-speech. Keep ze German accent consistent in every line.`;

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
