import yt_dlp
import os
import time
import random

CHANNEL_URL = "https://www.youtube.com/@ChartWhisperer/videos"
OUTPUT_FILE = os.path.join(os.path.expanduser("~"), "OneDrive", "Desktop", "chartwhisperer_transcripts.txt")
SUBS_DIR = os.path.join(os.path.expanduser("~"), "OneDrive", "Desktop", "subs_temp")
COOLDOWN_EVERY = 50
COOLDOWN_SECONDS = 30

os.makedirs(SUBS_DIR, exist_ok=True)

print("Fetching video list (last 3 years)...")
with yt_dlp.YoutubeDL({"quiet": True, "extract_flat": True, "dateafter": "20230101", "cookies_from_browser": ("chrome",)}) as ydl:
    info = ydl.extract_info(CHANNEL_URL, download=False)
    videos = info.get("entries", [])

print("Found " + str(len(videos)) + " videos. Downloading subtitles...\n")
processed = 0
skipped = 0

with open(OUTPUT_FILE, "w", encoding="utf-8") as out:
    out.write("CHART WHISPERER - TRANSCRIPT HISTORY (Last 3 Years)\n")
    out.write("=====================================================\n\n")

    for i, video in enumerate(videos):
        video_id = video.get("id", "")
        title = video.get("title", "Unknown Title")
        url = "https://www.youtube.com/watch?v=" + video_id

        if i % 20 == 0:
            batch_num = i // 20 + 1
            total = (len(videos) + 19) // 20
            print("--- Batch " + str(batch_num) + "/" + str(total) + " ---")

        sub_opts = {
            "quiet": True,
            "skip_download": True,
            "writeautomaticsub": True,
            "writesubtitles": True,
            "subtitleslangs": ["en"],
            "subtitlesformat": "vtt",
            "outtmpl": os.path.join(SUBS_DIR, "%(id)s.%(ext)s"),
            "cookies_from_browser": ("chrome",),
            "ignoreerrors": True,
            "retries": 3,
            "sleep_interval": 3,
            "max_sleep_interval": 6,
        }

        try:
            with yt_dlp.YoutubeDL(sub_opts) as ydl:
                ydl.download([url])

            sub_file = os.path.join(SUBS_DIR, video_id + ".en.vtt")
            if not os.path.exists(sub_file):
                raise FileNotFoundError("No subtitle file created")

            with open(sub_file, "r", encoding="utf-8") as sf:
                lines = sf.readlines()

            text_lines = []
            for line in lines:
                line = line.strip()
                if line and not line.startswith("WEBVTT") and "-->" not in line and not line.isdigit():
                    text_lines.append(line)
            full_text = " ".join(text_lines)

            out.write("VIDEO TITLE: " + title + "\n")
            out.write("VIDEO URL:   " + url + "\n")
            out.write("-" * 50 + "\n")
            out.write(full_text + "\n\n")
            out.write("=" * 80 + "\n\n")
            out.flush()

            os.remove(sub_file)
            print("  OK " + title[:70])
            processed += 1

        except Exception as e:
            err_str = str(e)
            out.write("VIDEO TITLE: " + title + "\n[No transcript]\n")
            out.write("=" * 80 + "\n\n")
            out.flush()
            print("  SKIP: " + title[:55] + " | " + err_str[:60])
            skipped += 1
            if "429" in err_str:
                print("  [429 rate limit - backing off 90s...]")
                time.sleep(90)

        time.sleep(4.0 + random.uniform(0, 2.0))
        if (i + 1) % COOLDOWN_EVERY == 0:
            print("  [Cooldown " + str(COOLDOWN_SECONDS) + "s...]")
            time.sleep(COOLDOWN_SECONDS)

print("\nDone! " + OUTPUT_FILE)
print("Transcripts: " + str(processed) + "  |  Skipped: " + str(skipped))
