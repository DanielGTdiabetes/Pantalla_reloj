import { apiRequest } from './config';

export interface VoiceDefinition {
  id: string;
  name: string;
  lang: string;
  type: string;
}

export async function fetchVoices(): Promise<VoiceDefinition[]> {
  return await apiRequest<VoiceDefinition[]>('/tts/voices');
}

export async function speakPreview(voice: string | undefined, text: string, volume: number): Promise<void> {
  await apiRequest('/tts/speak', {
    method: 'POST',
    body: JSON.stringify({ voice, text, volume }),
  });
}

export async function enqueueAlertTts(text: string): Promise<void> {
  await apiRequest('/alerts/tts', {
    method: 'POST',
    body: JSON.stringify({ text }),
  });
}
