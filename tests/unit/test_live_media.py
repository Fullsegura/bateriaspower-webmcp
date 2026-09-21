from __future__ import annotations

import base64

from agent.fast_api_app import MAX_VIDEO_FRAME_BYTES, _live_video_blob


def test_live_video_accepts_bounded_jpeg() -> None:
    frame = _live_video_blob(
        {
            "data": base64.b64encode(b"jpeg-frame").decode("ascii"),
            "mime_type": "image/jpeg",
        }
    )

    assert frame is not None
    assert frame.data == b"jpeg-frame"
    assert frame.mime_type == "image/jpeg"


def test_live_video_rejects_invalid_or_oversized_frames() -> None:
    assert _live_video_blob({"data": "not-base64", "mime_type": "image/jpeg"}) is None
    assert _live_video_blob({"data": "eA==", "mime_type": "image/png"}) is None
    assert (
        _live_video_blob(
            {
                "data": base64.b64encode(
                    b"x" * (MAX_VIDEO_FRAME_BYTES + 1)
                ).decode("ascii"),
                "mime_type": "image/jpeg",
            }
        )
        is None
    )
