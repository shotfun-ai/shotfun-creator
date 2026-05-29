# Voice Catalog Format

TTS voice catalogs should live in `references/voice_<platform>.json`.

The `<platform>` part is the value passed to `--voice-platform`. For example, `--voice-platform minimax` reads `references/voice_minimax.json`.

## JSON Structure

```json
{
  "platform": "demo",
  "provider": "DemoVoice",
  "defaultVoiceId": "demo_ming_002",
  "voices": [
    {
      "voiceId": "demo_lina_001",
      "voiceName": "Lina",
      "language": "en-US",
      "description": "Warm narration",
      "tags": ["female", "narration"],
      "attributes": {
        "gender": "female",
        "age": "young_adult",
        "style": "narration"
      }
    },
    {
      "voiceId": "demo_ming_002",
      "voiceName": "Ming",
      "language": "zh-CN",
      "description": "Clear Mandarin male",
      "tags": ["male", "default"],
      "attributes": {
        "gender": "male",
        "age": "adult",
        "style": "commercial"
      }
    }
  ]
}
```

## Top-Level Fields

- `platform`: required. Platform key, must match the filename suffix.
- `provider`: required. Human-readable provider or vendor name.
- `defaultVoiceId`: recommended. Fallback voice used when the user does not specify a voice.
- `voices`: required. Array of available voices for this platform.

Optional top-level fields may be added for platform-specific metadata, such as `region`, `model`, `pricing`, or `notes`.

## Voice Fields

- `voiceId`: required. Provider voice ID sent to the TTS task.
- `voiceName`: required. Human-readable name users can request.
- `language`: recommended. Language or locale, such as `zh-CN` or `en-US`.
- `description`: recommended. Short voice description used for AI recommendation.
- `tags`: recommended. Array of machine-readable tags. Include `default` to mark a fallback voice.
- `attributes`: optional. Object for platform-specific properties such as gender, age, style, accent, emotion, or scenario.

## Selection Order

1. `--voice-id` matches `voiceId`.
2. `--voice-name` matches `voiceName`, or `voiceId` as a convenience.
3. If neither is provided, use `defaultVoiceId`.
4. If no `defaultVoiceId` exists, use a voice whose `tags` include `default`.
5. If no default exists, use the first voice in `voices`.

The CLI submits the resolved `voiceId` to the audio task and may also include `voiceName`, `voicePlatform`, and `language` for traceability.

## Legacy Markdown

Older `references/voice_<platform>.md` files used YAML front matter plus a Markdown table. New catalogs should use JSON because the data is machine-read, typed, and easier to validate.
