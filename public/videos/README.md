# Homepage demo video

The homepage hero player (`src/app/HeroDemo.tsx`) loads the recorded Remy demo
from this folder.

## Required file

```
public/videos/remy-demo.mp4   ->   served at  /videos/remy-demo.mp4
```

The filename is matched **exactly**, including case. Local Windows dev is
case-insensitive but Vercel's build/runtime is Linux and is **not** — a file
committed as `Remy-Demo.MP4` will 404 in production while working fine on your
machine. Keep it lowercase-hyphenated: `remy-demo.mp4`.

## Encoding

Use H.264 video + AAC audio in an `.mp4` container (`yuv420p` pixel format).
That combination plays in Safari, Chrome, Firefox and Edge on both desktop and
mobile. HEVC/H.265, AV1 and ProRes do **not** play everywhere.

```bash
ffmpeg -i source.mov -vf "scale=1280:-2" -c:v libx264 -profile:v high \
  -pix_fmt yuv420p -crf 24 -preset slow -c:a aac -b:a 128k -movflags +faststart \
  public/videos/remy-demo.mp4
```

`-movflags +faststart` matters: it moves the index to the front of the file so
playback can start before the whole file has downloaded.

## Size

The player autoplays on every homepage visit, so this file is downloaded by
every visitor. Keep it **under ~10 MB**; aim for 5 MB. A 16:9 clip at 1280x720
and CRF 24 gets a 2-minute demo comfortably into that range.

If the demo has to be larger, host it on a CDN or blob store instead and set
`NEXT_PUBLIC_REMY_DEMO_VIDEO_URL` to that public URL — the player prefers the
env var over this file when it is set, no code change needed.

## Behaviour when the file is absent

The player falls back to the branded `RemyDemoAnimation` rather than showing a
black box, so a missing or unplayable file degrades gracefully.
