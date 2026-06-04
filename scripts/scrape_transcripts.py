import scrapetube
from youtube_transcript_api import YouTubeTranscriptApi
from youtube_transcript_api._errors import NoTranscriptFound, TranscriptsDisabled
import time

CHANNEL_ID = "UCez8uA1o_fDYsrSf4auWSjg"
OUTPUT_FILE = "oscar_carboni_all_transcripts.txt"
BATCH_SIZE = 20
DELAY_BETWEEN_VIDEOS = 0.5
DELAY_BETWEEN_BATCHES = 3.0

print("Fetching video list from channel...")
videos = list(scrapetube.get_channel(CHANNEL_ID))
print(f"Found {len(videos)} videos. Processing in batches of {BATCH_SIZE}...\n")

processed = 0
skipped = 0
errors = 0

with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
    f.write("OSCAR CARBONI OMNI TRADING ACADEMY - TRANSCRIPT HISTORY\n")
    f.write("=====================================================\n\n")

    for batch_start in range(0, len(videos), BATCH_SIZE):
        batch = videos[batch_start:batch_start + BATCH_SIZE]
        batch_num = batch_start // BATCH_SIZE + 1
        total_batches = (len(videos) + BATCH_SIZE - 1) // BATCH_SIZE
        print(f"--- Batch {batch_num}/{total_batches} (videos {batch_start+1}–{batch_start+len(batch)}) ---")

        for video in batch:
            video_id = video['videoId']

            title_text = "Unknown Title"
            if 'title' in video and 'runs' in video['title']:
                title_text = "".join([r.get('text', '') for r in video['title']['runs']])

            date_text = "Unknown Date"
            if 'publishedTimeText' in video and 'simpleText' in video['publishedTimeText']:
                date_text = video['publishedTimeText']['simpleText']

            try:
                transcript_list = YouTubeTranscriptApi.get_transcript(video_id)
                full_text = " ".join([entry['text'] for entry in transcript_list])

                f.write(f"VIDEO TITLE: {title_text}\n")
                f.write(f"PUBLISHED:   {date_text}\n")
                f.write(f"VIDEO URL:   https://youtu.be/{video_id}\n")
                f.write("-" * 50 + "\n")
                f.write(full_text + "\n\n")
                f.write("=" * 80 + "\n\n")
                f.flush()

                print(f"  ✓ {title_text[:60]}")
                processed += 1

            except (NoTranscriptFound, TranscriptsDisabled):
                f.write(f"VIDEO TITLE: {title_text} ({date_text})\n")
                f.write("[No transcript available]\n")
                f.write("=" * 80 + "\n\n")
                f.flush()
                print(f"  – SKIP (no transcript): {title_text[:60]}")
                skipped += 1

            except Exception as e:
                print(f"  ✗ ERROR {title_text[:50]}: {e}")
                errors += 1

            time.sleep(DELAY_BETWEEN_VIDEOS)

        print(f"  Batch done. Pausing {DELAY_BETWEEN_BATCHES}s...\n")
        time.sleep(DELAY_BETWEEN_BATCHES)

print(f"\nDone! Saved to: {OUTPUT_FILE}")
print(f"  Transcripts: {processed}  |  Skipped: {skipped}  |  Errors: {errors}")
