"""
Oscar Carboni Transcript Scraper — incremental update
======================================================
On first run: scrapes all videos and writes the output file.
On subsequent runs: reads the existing file, skips already-scraped
video IDs, and appends only new videos to the end.

Usage:
    python scripts/scrape_transcripts.py
    python scripts/scrape_transcripts.py --output C:\Atlas\transcripts\oscar.txt
    python scripts/scrape_transcripts.py --full   # re-scrape everything from scratch
"""

import argparse
import re
import time
import os

CHANNEL_ID          = "UCez8uA1o_fDYsrSf4auWSjg"
DEFAULT_OUTPUT_FILE = "oscar_carboni_all_transcripts.txt"
BATCH_SIZE          = 20
DELAY_BETWEEN_VIDEOS  = 1.5   # seconds — be polite to YouTube
DELAY_BETWEEN_BATCHES = 5.0


def load_known_ids(output_file: str) -> set[str]:
    """Return set of video IDs already in the transcript file."""
    known = set()
    if not os.path.exists(output_file):
        return known
    pattern = re.compile(r"https://youtu\.be/([A-Za-z0-9_\-]{11})")
    with open(output_file, "r", encoding="utf-8") as f:
        for line in f:
            m = pattern.search(line)
            if m:
                known.add(m.group(1))
    return known


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--output", default=DEFAULT_OUTPUT_FILE,
                    help="Path to transcript file (default: oscar_carboni_all_transcripts.txt)")
    ap.add_argument("--full", action="store_true",
                    help="Re-scrape everything from scratch (overwrites existing file)")
    args = ap.parse_args()

    output_file = args.output

    try:
        import scrapetube
    except ImportError:
        print("Installing scrapetube...")
        os.system(f"pip install scrapetube -q")
        import scrapetube

    try:
        from youtube_transcript_api import YouTubeTranscriptApi
        from youtube_transcript_api._errors import NoTranscriptFound, TranscriptsDisabled
    except ImportError:
        print("Installing youtube-transcript-api...")
        os.system(f"pip install youtube-transcript-api -q")
        from youtube_transcript_api import YouTubeTranscriptApi
        from youtube_transcript_api._errors import NoTranscriptFound, TranscriptsDisabled

    # Load already-scraped IDs
    if args.full:
        known_ids = set()
        file_mode = "w"
        print(f"Full re-scrape mode — overwriting {output_file}")
    else:
        known_ids = load_known_ids(output_file)
        file_mode = "a" if known_ids else "w"
        if known_ids:
            print(f"Incremental mode — {len(known_ids):,} videos already in {output_file}")
        else:
            print(f"No existing file found — starting fresh")

    # Fetch full video list from channel
    print(f"Fetching video list from channel...")
    videos = list(scrapetube.get_channel(CHANNEL_ID))
    print(f"Found {len(videos):,} total videos on channel")

    # Filter to only new ones
    new_videos = [v for v in videos if v["videoId"] not in known_ids]
    print(f"New videos to scrape: {len(new_videos):,}  |  Already have: {len(known_ids):,}\n")

    if not new_videos:
        print("Nothing new — already up to date.")
        return

    processed = 0
    skipped   = 0
    errors    = 0

    with open(output_file, file_mode, encoding="utf-8") as f:

        if file_mode == "w":
            f.write("OSCAR CARBONI OMNI TRADING ACADEMY - TRANSCRIPT HISTORY\n")
            f.write("=====================================================\n\n")
        else:
            f.write(f"\n{'='*80}\n")
            f.write(f"# INCREMENTAL UPDATE — scraped {time.strftime('%Y-%m-%d %H:%M')}\n")
            f.write(f"{'='*80}\n\n")

        for batch_start in range(0, len(new_videos), BATCH_SIZE):
            batch      = new_videos[batch_start:batch_start + BATCH_SIZE]
            batch_num  = batch_start // BATCH_SIZE + 1
            total_batches = (len(new_videos) + BATCH_SIZE - 1) // BATCH_SIZE
            print(f"--- Batch {batch_num}/{total_batches} "
                  f"(videos {batch_start+1}–{batch_start+len(batch)}) ---")

            for video in batch:
                video_id = video["videoId"]

                title_text = "Unknown Title"
                if "title" in video and "runs" in video["title"]:
                    title_text = "".join([r.get("text", "") for r in video["title"]["runs"]])

                date_text = "Unknown Date"
                if "publishedTimeText" in video and "simpleText" in video["publishedTimeText"]:
                    date_text = video["publishedTimeText"]["simpleText"]

                try:
                    transcript_list = YouTubeTranscriptApi.get_transcript(video_id)
                    full_text = " ".join([entry["text"] for entry in transcript_list])

                    f.write(f"VIDEO TITLE: {title_text}\n")
                    f.write(f"PUBLISHED:   {date_text}\n")
                    f.write(f"VIDEO URL:   https://youtu.be/{video_id}\n")
                    f.write("-" * 50 + "\n")
                    f.write(full_text + "\n\n")
                    f.write("=" * 80 + "\n\n")
                    f.flush()

                    print(f"  + {title_text[:70]}")
                    processed += 1

                except (NoTranscriptFound, TranscriptsDisabled):
                    f.write(f"VIDEO TITLE: {title_text} ({date_text})\n")
                    f.write(f"VIDEO URL:   https://youtu.be/{video_id}\n")
                    f.write("[No transcript available]\n")
                    f.write("=" * 80 + "\n\n")
                    f.flush()
                    print(f"  - SKIP (no transcript): {title_text[:60]}")
                    skipped += 1

                except Exception as e:
                    err_str = str(e)
                    print(f"  x ERROR {title_text[:50]}: {err_str[:80]}")
                    if "429" in err_str:
                        print("  [Rate limited — waiting 2 minutes...]")
                        time.sleep(120)
                    errors += 1

                time.sleep(DELAY_BETWEEN_VIDEOS)

            print(f"  Batch done. Pausing {DELAY_BETWEEN_BATCHES}s...\n")
            time.sleep(DELAY_BETWEEN_BATCHES)

    print(f"\nDone! Saved to: {output_file}")
    print(f"  New transcripts : {processed:,}")
    print(f"  Skipped (no CC) : {skipped:,}")
    print(f"  Errors          : {errors:,}")
    print(f"  Total in file   : {len(known_ids) + processed:,}")


if __name__ == "__main__":
    main()
