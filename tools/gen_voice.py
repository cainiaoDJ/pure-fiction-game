#!/usr/bin/env python3
"""
调用 MiniMax T2A v2 API，把 scenes.json 里的所有台词生成 mp3。
输出到 assets/voice/<speaker_key>/<scene_id>.mp3。

需要：
  - 环境变量 MINIMAX_API_KEY（Subscription Key；从 https://platform.minimaxi.com/user-center/basic-information/interface-key 取）
  - pip install requests
"""
import json
import os
import sys
import time
import urllib.request
import urllib.error
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCENES_JSON = ROOT / "tools" / "scenes.json"
VOICE_DIR = ROOT / "assets" / "voice"
ENV_FILE = Path.home() / ".minimax-agent-cn" / ".env"


def load_api_key() -> str:
    """优先级：环境变量 > ~/.minimax-agent-cn/.env。绝不在 stdout 打印 key。"""
    k = os.environ.get("MINIMAX_API_KEY") or os.environ.get("API_KEY")
    if k:
        return k
    if ENV_FILE.exists():
        for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" in line:
                name, _, val = line.partition("=")
                if name.strip() in ("MINIMAX_API_KEY", "API_KEY"):
                    return val.strip().strip('"').strip("'")
    return ""

# 国内端点（Token Plan sk-cp key 走这个）
T2A_URL = "https://api.minimaxi.com/v1/t2a_v2"

# 4 个主 NPC + 旁白/配角/AI 的音色预设
# MiniMax 系统音色 ID（speech-2.8-hd 可用）
VOICE_MAP = {
    "amber":      "female-yujie",       # 成熟、略带疲惫的女声
    "zero":       "male-qn-qingse",     # 清澈偏低的男声
    "lawyer":     "female-yujie",       # 律师也用 yujie，区别靠 speed 调
    "agent":      "male-qn-jingying",   # 精英男声
    "narrator":   "presenter_male",     # 旁白用新闻男声
    "clerk":      "presenter_female",   # 书记员
    "data":       "male-qn-jingying",   # 数据员（克制男声）
    "accountant": "male-qn-jingying",   # 会计
    "monitor":    "presenter_male",     # 监控台
    "oracle":     "female-tianmei",     # AI 用偏冷静的女声
}

# 语速 / 情绪 微调（每个 speaker_key 可选覆盖）
SPEED_MAP = {
    "amber":   0.95,   # 慢一点点，配合疲惫感
    "zero":    0.90,   # 慢、低沉
    "lawyer":  1.00,   # 律师中等
    "agent":   1.05,   # 经纪人略快
    "narrator": 0.92,  # 旁白从容
    "oracle":  0.95,
}
PITCH_MAP = {
    "zero":   -2,      # 偏低
    "lawyer": 1,       # 略高
    "amber":  0,
}


def t2a(text: str, voice_id: str, speed: float, pitch: int, api_key: str, retries: int = 3) -> bytes:
    """调一次 T2A v2，返回 mp3 二进制。"""
    payload = {
        "model": "speech-2.8-hd",
        "text": text,
        "stream": False,
        "voice_setting": {
            "voice_id": voice_id,
            "speed": speed,
            "vol": 1.0,
            "pitch": pitch,
        },
        "audio_setting": {
            "sample_rate": 32000,
            "bitrate": 128000,
            "format": "mp3",
            "channel": 1,
        },
    }
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        T2A_URL,
        data=data,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                body = resp.read().decode("utf-8")
            obj = json.loads(body)
            d = obj.get("data", {})
            if "audio" in d:
                return bytes.fromhex(d["audio"])
            if "audio_file" in d:
                print(f"  async task, file_id: {d['audio_file']}")
                return None
            print(f"  unexpected response: {obj}")
            time.sleep(2)
        except urllib.error.HTTPError as e:
            print(f"  HTTP {e.code}: {e.read().decode('utf-8', 'replace')[:200]}")
            time.sleep(2 ** attempt)
        except Exception as e:
            print(f"  attempt {attempt+1} error: {e}")
            time.sleep(2 ** attempt)
    return None


def main():
    api_key = load_api_key()
    if not api_key:
        print("未找到 API Key。")
        print("  方式 1：export MINIMAX_API_KEY=sk-cp-...")
        print("  方式 2：在 ~/.minimax-agent-cn/.env 写入 API_KEY=sk-cp-...")
        sys.exit(1)
    print(f"已从 {'环境变量' if os.environ.get('MINIMAX_API_KEY') or os.environ.get('API_KEY') else '~/.minimax-agent-cn/.env'} 加载 API Key（{len(api_key)} 字符）")
    print()

    scenes = json.loads(SCENES_JSON.read_text(encoding="utf-8"))
    total_chars = sum(s["char_count"] for s in scenes)
    print(f"共 {len(scenes)} 段，{total_chars} 字符")
    print()

    # 预估时间（speech-2.8-hd 约 30-50 字/秒；这里按 25 字/秒 + 0.5s 网络）
    est_seconds = total_chars / 25 + len(scenes) * 0.5
    print(f"预计耗时：{est_seconds:.0f}s（实际取决于网络）")
    print()

    VOICE_DIR.mkdir(parents=True, exist_ok=True)

    ok, skip, fail = 0, 0, 0
    for s in scenes:
        spk = s["speaker_key"]
        out_dir = VOICE_DIR / spk
        out_dir.mkdir(parents=True, exist_ok=True)
        out_path = out_dir / f"{s['id']}.mp3"

        if out_path.exists() and out_path.stat().st_size > 100:
            print(f"  ✓ {s['id']:14s} ({spk:10s}) skip, exists")
            skip += 1
            continue

        voice = VOICE_MAP.get(spk, "presenter_male")
        speed = SPEED_MAP.get(spk, 1.0)
        pitch = PITCH_MAP.get(spk, 0)

        print(f"  → {s['id']:14s} ({spk:10s}) voice={voice:20s} speed={speed} chars={s['char_count']}", end=" ... ", flush=True)
        audio = t2a(s["text"], voice, speed, pitch, api_key)
        if audio:
            out_path.write_bytes(audio)
            print(f"done ({len(audio)} bytes)")
            ok += 1
        else:
            print("FAILED")
            fail += 1
        time.sleep(0.3)  # 避免触发 RPM

    print()
    print(f"=== 完成：成功 {ok} / 跳过 {skip} / 失败 {fail} ===")


if __name__ == "__main__":
    main()
