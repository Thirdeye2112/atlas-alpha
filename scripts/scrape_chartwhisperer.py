"""
Chart Whisperer (Oscar Carboni) Transcript Scraper — incremental update
========================================================================
Uses yt-dlp to download auto-generated subtitles from the YouTube channel.
On first run: scrapes all videos from the last 3 years and writes the output file.
On subsequent runs: reads the existing file, skips already-scraped video IDs,
and appends only new videos.

Usage:
    python scripts/scrape_chartwhisperer.py
    python scripts/scrape_chartwhisperer.py --output "C:\\path\\to\\transcripts.txt"
    python scripts/scrape_chartwhisperer.py --full    # re-scrape everything from scratch
    python scripts/scrape_chartwhisperer.py --dry-run # show what would be scraped, no download
"""

import argparse
import os
import re
import time
import random
import tempfile

CHANNEL_URL      = "https://www.youtube.com/@ChartWhisperer/videos"
DEFAULT_OUTPUT   = os.path.join(os.path.expanduser("~"), "OneDrive", "Desktop",
                                "chartwhisperer_transcripts.txt")
COOLDOWN_EVERY   = 50
COOLDOWN_SECONDS = 30
DATE_AFTER       = "20230101"   # only fetch videos from 2023 onwards


def load_known_ids(output_file: str) -> set[str]:
    """Return set of video IDs already in the transcript file."""
    known = set()
    if not os.path.exists(output_file):
        return known
    pattern = re.compile(r"youtube\.com/watch\?v=([A-Za-z0-9_\-]{11})")
    with open(output_file, "r", encoding="utf-8") as f:
        for line in f:
            m = pattern.search(line)
            if m:
                known.add(m.group(1))
    return known


def clean_vtt(lines: list[str]) -> str:
    """Strip VTT timing tags and dedup repeated lines."""
    seen   = set()
    clean  = []
    tag_re = re.compile(r"<[^>]+>")
    for line in lines:
        line = line.strip()
        if (not line
                or line.startswith("WEBVTT")
                or "-->" in line
                or line.isdigit()
                or line.startswith("Kind:")
                or line.startswith("Language:")):
            continue
        line = tag_re.sub("", line).strip()
        if line and line not in seen:
            seen.add(line)
            clean.append(line)
    return " ".join(clean)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--output",  default=DEFAULT_OUTPUT,
                    help="Path to output transcript file")
    ap.add_argument("--full",    action="store_true",
                    help="Re-scrape everything from scratch (overwrites file)")
    ap.add_argument("--dry-run", action="store_true",
                    help="Show what would be scraped without downloading")
    args = ap.parse_args()

    try:
        import yt_dlp
    except ImportError:
        print("Installing yt-dlp...")
        os.system("pip install yt-dlp -q")
        import yt_dlp

    output_file = args.output

    # Load known IDs
    if args.full:
        known_ids = set()
        file_mode = "w"
        print(f"Full re-scrape mode — overwriting {output_file}")
    else:
        known_ids = load_known_ids(output_file)
        file_mode = "a" if known_ids else "w"
        if known_ids:
            print(f"Incremental mode — {len(known_ids):,} videos already in file")
        else:
            print("No existing file — starting fresh")

    # Fetch video list
    print("Fetching video list from channel...")
    ydl_opts = {
        "quiet":        True,
        "extract_flat": True,
        "dateafter":    DATE_AFTER,
        "cookies_from_browser": ("chrome",),
    }
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info   = ydl.extract_info(CHANNEL_URL, download=False)
        videos = info.get("entries", [])

    print(f"Found {len(videos):,} videos on channel (since {DATE_AFTER})")

    new_videos = [v for v in videos if v.get("id", "") not in known_ids]
    print(f"New videos to scrape: {len(new_videos):,}  |  Already have: {len(known_ids):,}\n")

    if not new_videos:
        print("Nothing new — already up to date.")
        return

    if args.dry_run:
        print("DRY RUN — would scrape:")
        for v in new_videos[:20]:
            print(f"  {v.get('id','')}  {v.get('title','')[:70]}")
        if len(new_videos) > 20:
            print(f"  ... and {len(new_videos)-20} more")
        return

    processed = 0
    skipped   = 0

    subs_dir = tempfile.mkdtemp(prefix="cw_subs_")

    with open(output_file, file_mode, encoding="utf-8") as out:
        if file_mode == "w":
            out.write("CHART WHISPERER - TRANSCRIPT HISTORY\n")
            out.write("=====================================\n\n")
        else:
            out.write(f"\n{'='*80}\n")
            out.write(f"# INCREMENTAL UPDATE — scraped {time.strftime('%Y-%m-%d %H:%M')}\n")
            out.write(f"{'='*80}\n\n")

        for i, video in enumerate(new_videos):
            video_id = video.get("id", "")
            title    = video.get("title", "Unknown Title")
            url      = f"https://www.youtube.com/watch?v={video_id}"

            if i % 20 == 0:
                batch_num = i // 20 + 1
                total     = (len(new_videos) + 19) // 20
                print(f"--- Batch {batch_num}/{total} ---")

            sub_opts = {
                "quiet":            True,
                "skip_download":    True,
                "writeautomaticsub": True,
                "writesubtitles":   True,
                "subtitleslangs":   ["en"],
                "subtitlesformat":  "vtt",
                "outtmpl":          os.path.join(subs_dir, "%(id)s.%(ext)s"),
                "cookies_from_browser": ("chrome",),
                "ignoreerrors":     True,
                "retries":          3,
                "sleep_interval":   3,
                "max_sleep_interval": 6,
            }

            try:
                with yt_dlp.YoutubeDL(sub_opts) as ydl:
                    ydl.download([url])

                sub_file = os.path.join(subs_dir, f"{video_id}.en.vtt")
                if not os.path.exists(sub_file):
                    raise FileNotFoundError("No subtitle file")

                with open(sub_file, "r", encoding="utf-8") as sf:
                    raw_lines = sf.readlines()
                full_text = clean_vtt(raw_lines)

                out.write(f"VIDEO TITLE: {title}\n")
                out.write(f"VIDEO URL:   {url}\n")
                out.write("-" * 50 + "\n")
                out.write(full_text + "\n\n")
                out.write("=" * 80 + "\n\n")
                out.flush()

                try:
                    os.remove(sub_file)
                except OSError:
                    pass

                print(f"  + {title[:70]}")
                processed += 1

            except Exception as e:
                err_str = str(e)
                out.write(f"VIDEO TITLE: {title}\n")
                out.write(f"VIDEO URL:   {url}\n")
                out.write("[No transcript]\n")
                out.write("=" * 80 + "\n\n")
                out.flush()
                print(f"  - SKIP: {title[:55]}  |  {err_str[:60]}")
                skipped += 1
                if "429" in err_str:
                    print("  [Rate limited — waiting 2 minutes...]")
                    time.sleep(120)

            time.sleep(4.0 + random.uniform(0, 2.0))
            if (i + 1) % COOLDOWN_EVERY == 0:
                print(f"  [Cooldown {COOLDOWN_SECONDS}s...]")
                time.sleep(COOLDOWN_SECONDS)

    # Clean up temp dir
    try:
        os.rmdir(subs_dir)
    except OSError:
        pass

    print(f"\nDone! → {output_file}")
    print(f"  New transcripts : {processed:,}")
    print(f"  Skipped (no CC) : {skipped:,}")
    print(f"  Total in file   : {len(known_ids) + processed:,}")


if __name__ == "__main__":
    main()
