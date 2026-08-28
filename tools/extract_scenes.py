#!/usr/bin/env python3
"""
从 game.js 里静态提取所有 S(...) 场景的 (speaker, text) 列表。
输出 scenes.json 供 gen_voice.py 使用。

S() 调用都是单行；function(){ return S(...); } 在下一行工具单独处理。
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GAME_JS = ROOT / "game.js"
OUT_JSON = ROOT / "tools" / "scenes.json"

SPEAKER_KEY = {
    "琥珀": "amber",
    "零号": "zero",
    "律师": "lawyer",
    "经纪人": "agent",
    "旁白": "narrator",
    "书记员": "clerk",
    "数据员": "data",
    "会计": "accountant",
    "监控台": "monitor",
    "甲骨文 AI": "oracle",
}


def strip_html(s: str) -> str:
    s = re.sub(r"<br\s*/?>", "，", s, flags=re.I)
    s = re.sub(r"<[^>]+>", "", s)
    s = s.replace("\u3000", " ")
    s = re.sub(r" +", " ", s)
    return s.strip()


def parse_s_call_at(text: str, s_pos: int):
    """
    text[s_pos] 必须指向 'S'（'S(' 中的 S 字符），向后解析 3 个 '...' 字符串参数。
    返回 (chapter, speaker, body, end_pos) 或 None。
    body 可跨行（直到 ASCII 单引号结束）。
    """
    # 跳过 'S('
    pos = s_pos + 2
    parts = []
    while len(parts) < 3 and pos < len(text):
        # skip whitespace, newline and comma
        while pos < len(text) and text[pos] in " \t\n,":
            pos += 1
        if pos >= len(text) or text[pos] != "'":
            return None
        pos += 1
        start_q = pos
        while pos < len(text):
            if text[pos] == "\\" and pos + 1 < len(text):
                pos += 2
                continue
            if text[pos] == "'":
                break
            pos += 1
        if pos >= len(text):
            return None
        parts.append(text[start_q:pos])
        pos += 1
    if len(parts) < 3:
        return None
    return (parts[0], parts[1], parts[2], pos)


def find_owning_function(src: str, pos: int):
    """返回 pos 所在的最内层 `:function(){...}` 的函数名。"""
    last = None
    for fm in re.finditer(r"([A-Za-z_][\w-]*)\s*:\s*function\s*\(\s*\)\s*\{", src):
        if fm.end() > pos:
            break
        last = fm.group(1)
    return last


def main():
    src = GAME_JS.read_text(encoding="utf-8")

    seen = set()
    scenes = []

    # 找所有 S( 调用：覆盖 xxx:S( 和 return S( 两种
    for m in re.finditer(
        r"(?:(?:[A-Za-z_][\w-]*|'[A-Za-z0-9_-]+')\s*:\s*|return\s+)S\(",
        src,
    ):
        prefix = src[m.start():m.end() - 2]  # 整段匹配去掉 S(
        is_return = prefix.strip().startswith("return")
        if is_return:
            sid = find_owning_function(src, m.start()) or f"anon_{m.start()}"
        else:
            sm = re.match(
                r"\s*(?:([A-Za-z_][\w-]*)|'([A-Za-z0-9_-]+)')\s*:\s*",
                prefix,
            )
            sid = (sm.group(1) or sm.group(2)) if sm else None
        if not sid:
            continue
        s_pos = m.end() - 2  # S 的位置
        r = parse_s_call_at(src, s_pos)
        if not r:
            continue
        chapter, speaker, body, _end = r
        if sid in seen:
            continue
        seen.add(sid)
        scenes.append({
            "id": sid, "chapter": chapter, "speaker": speaker,
            "speaker_key": SPEAKER_KEY.get(speaker, "misc"),
            "text": strip_html(body), "is_dynamic": is_return,
        })


def main():
    src = GAME_JS.read_text(encoding="utf-8")

    seen = set()
    scenes = []

    # 找所有 S( 调用位置，跨行解析（覆盖 xxx:S( 和 return S( 两种）
    for m in re.finditer(
        r"(?:(?:[A-Za-z_][\w-]*|'[A-Za-z0-9_-]+')\s*:\s*|return\s+)S\(",
        src,
    ):
        # 跳过 return S() 的情形：把 sid 设为括号外那行的函数名
        prefix = src[m.start():m.end() - 2]  # 去掉末尾的 S(
        if prefix.strip().startswith("return"):
            # 用所属函数名作 sid
            fid_match = re.search(
                r"([A-Za-z_][\w-]*)\s*:\s*function\s*\(\s*\)",
                src[:m.start()][::-1],  # 反向找最近的 :function
            )
            # 上面反向写太绕，直接正向找
            fid = None
            for fm in re.finditer(r"([A-Za-z_][\w-]*)\s*:\s*function\s*\(\s*\)\s*\{", src):
                if fm.end() > m.start():
                    break
                fid = fm.group(1)
            sid = fid or f"anon_{m.start()}"
        else:
            sid_match = re.match(
                r"\s*(?:([A-Za-z_][\w-]*)|'([A-Za-z0-9_-]+)')\s*:\s*",
                prefix,
            )
            sid = (sid_match.group(1) or sid_match.group(2)) if sid_match else None
        if not sid:
            continue
        # 找 S( 的位置（去掉前缀后的 S(）
        s_pos = m.end() - 2
        r = parse_s_call_at(src, s_pos)
        if not r:
            continue
        chapter, speaker, body, _end = r
        if sid in seen:
            continue
        seen.add(sid)
        scenes.append({
            "id": sid, "chapter": chapter, "speaker": speaker,
            "speaker_key": SPEAKER_KEY.get(speaker, "misc"),
            "text": strip_html(body), "is_dynamic": prefix.strip().startswith("return"),
        })

    # 单独加入 hidden_ending（用 ending 的脚本+隐藏分支模板），front-end 用 ending() 动态返回时附带 audio_key
    # 这里只把常规 4 个 ending + hidden_ending 共 5 个变体列上，front-end 根据条件选播
    ENDING_VARIANTS = [
        ("ending_a", "结局零 / 算法声明",
         "庭审是结束了。但新闻发布会上发言的不是琥珀——是一份被署了你名字的算法声明。她的边界由你交给了工具。工具按它的方式完成了任务。你拿到了热度，工具拿到了署名权。"),
        ("ending_b", "结局一 / 没有故事的人",
         "白塔的程序缓慢推进，热搜终于失去燃料。琥珀没有赢得一场口水战；她只是拒绝被写成任何一种方便转发的人。第七码头的灯熄灭时，镜港第一次把\u201c未审理\u201d读成完整的四个字。"),
        ("ending_c", "结局二 / 鲨鱼也会哭",
         "你们都赢得了热搜。小说被剪成证词，证据被剪成梗图，所有人都在自己的版本里胜诉。几周后，没有人记得争议是什么；镜港只记得那晚的流量创下纪录。"),
        ("ending_d", "结局三 / 草稿箱未删除",
         "你公开了流量预案的空白模板。人们突然看见，每一场\u201c偶然爆发\u201d的舆论，都预留了主角、反派、反转和广告位。没有人因此变得无辜，但第一次，有人看见了剧本的提词器。"),
        ("ending_hidden", "结局特 / 白塔的钟声",
         "你手里有完整的三件证据。你没有动用过 AI。程序时间线、传播预案、原始录音，已经整整齐齐地摆在白塔的案卷里。法庭不是被舆论左右的。也不是被 AI 加速的。它被一份完整的事实推着，缓慢地、不可逆地走到了它的位置。第七码头的灯熄灭的时候，白塔的钟敲了。镜港第一次听见——\u201c未审理\u201d不是一句话，是一个过程。"),
    ]
    for eid, title, text in ENDING_VARIANTS:
        scenes.append({
            "id": eid, "chapter": "终章 / 第七码头", "speaker": "旁白",
            "speaker_key": "narrator",
            "text": f"{title}。{text}", "is_dynamic": True,
        })

    # 排序
    main_ids = ["start", "receipt", "novel", "switchboard", "screenshot", "call",
                "lounge", "ledger", "archive", "oracle", "backstage", "stage",
                "choir", "dawn"]
    crisis_ids = [f"ev-{h}" for h in (60, 48, 36, 24, 12)]
    ending_ids = ["ending_a", "ending_b", "ending_c", "ending_d", "ending_hidden"]
    order = {k: i for i, k in enumerate(main_ids + crisis_ids + ending_ids)}
    scenes.sort(key=lambda s: (order.get(s["id"], 999), s["id"]))

    for s in scenes:
        s["char_count"] = len(s["text"])

    total_chars = sum(s["char_count"] for s in scenes)
    by_speaker = {}
    for s in scenes:
        by_speaker.setdefault(s["speaker_key"], []).append(s)

    OUT_JSON.write_text(json.dumps(scenes, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"提取到 {len(scenes)} 个场景，共 {total_chars} 字符\n")
    print(f"按 speaker 分组：")
    for k, v in by_speaker.items():
        chars = sum(x["char_count"] for x in v)
        print(f"  {k:12s} {len(v):>2} 段  {chars:>4} 字符")
    print(f"\n输出到 {OUT_JSON}")


if __name__ == "__main__":
    main()
