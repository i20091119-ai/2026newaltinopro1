# -*- coding: utf-8 -*-
"""학생 활동지(PDF)와 같은 모양의 '고칠 수 있는' PPT 를 만든다.

왜 스크립트로 만드나:
  - PDF 를 이미지로 넣으면 글자를 못 고친다. 여기서는 모든 글자·표가 진짜 텍스트다.
  - 활동지 내용이 바뀌면 이 파일만 고쳐 다시 돌리면 PDF·PPT 가 같이 따라온다.

만들어지는 것: docs/학생_활동지.pptx  (A4 세로 1장)
고치는 법: 파워포인트에서 그냥 글자를 클릭해 수정. 빈칸은 '밑줄 친 빈칸' 이라
          그 자리에 바로 타이핑하면 된다. 표도 진짜 표라서 칸을 더하거나 지울 수 있다.
돌리는 법: python3 tools/make_worksheet_pptx.py
"""
from pptx import Presentation
from pptx.util import Cm, Pt, Emu
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.dml import MSO_LINE_DASH_STYLE
from pptx.oxml.ns import qn
import copy, os

C = lambda h: RGBColor.from_string(h)
INK, MUT = C('3A3230'), C('9B8F86')
BLUE, MINT, SUN, CORAL, GRAPE = C('5EA0FF'), C('37C9AD'), C('FFB23E'), C('FF7A86'), C('B085FF')
LINE = C('F0E6D8')
FONT = '맑은 고딕'          # 한국 윈도우 기본 — 어느 PC에서 열어도 모양이 유지된다

# A4 세로
PRS = Presentation()
PRS.slide_width, PRS.slide_height = Cm(21.0), Cm(29.7)
slide = PRS.slides.add_slide(PRS.slide_layouts[6])      # 빈 레이아웃

L, R = Cm(1.1), Cm(21.0 - 1.1)                          # 좌우 여백 11mm
W = R - L
y = Cm(1.4)                                             # 위 여백

def nofill_noline(sh):
    sh.fill.background(); sh.line.fill.background()
    sh.shadow.inherit = False

def box(x, top, w, h, fill=None, line=None, lw=2.0, radius=0.12):
    """둥근 사각형 하나."""
    sh = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, x, top, w, h)
    if radius is not None:
        sh.adjustments[0] = radius
    if fill: sh.fill.solid(); sh.fill.fore_color.rgb = fill
    else: sh.fill.background()
    if line: sh.line.color.rgb = line; sh.line.width = Pt(lw)
    else: sh.line.fill.background()
    sh.shadow.inherit = False
    sh.text_frame.word_wrap = True
    return sh

def tb(x, top, w, h, anchor=MSO_ANCHOR.MIDDLE):
    t = slide.shapes.add_textbox(x, top, w, h)
    tf = t.text_frame
    tf.word_wrap = True
    tf.margin_left = tf.margin_right = tf.margin_top = tf.margin_bottom = 0
    tf.vertical_anchor = anchor
    return tf

def para(tf, first=True):
    p = tf.paragraphs[0] if first else tf.add_paragraph()
    p.space_before = Pt(0); p.space_after = Pt(0)
    return p

def run(p, text, size=11, bold=False, color=INK, underline=False, font=FONT):
    r = p.add_run(); r.text = text
    f = r.font; f.name = font; f.size = Pt(size); f.bold = bold
    f.color.rgb = color; f.underline = underline
    # 동아시아 글꼴도 같이 지정해야 한글이 의도한 글꼴로 나온다
    rPr = r._r.get_or_add_rPr()
    ea = rPr.makeelement(qn('a:ea'), {'typeface': font}); rPr.append(ea)
    return r

def blank(p, chars=10, size=11, color=C('7A4FD0')):
    """학생이 적을 빈칸 — 밑줄 친 공백. 그 자리에 바로 타이핑하면 된다."""
    return run(p, ' ' * chars, size=size, bold=True, color=color, underline=True)

# ── 헤더 ──────────────────────────────────────────────────────────
tf = tb(L, y, W, Cm(1.3), MSO_ANCHOR.TOP)
p = para(tf); run(p, '🚚 알티노 자율배송 — 임무 기록 활동지', size=18, bold=True)
p = para(tf, False)
run(p, '경남수학문화관 · 자율배송 SW체험 · 센서 숫자로 ', size=9.5, color=MUT)
run(p, '주행 코드의 빈칸', size=9.5, bold=True, color=MUT)
run(p, '을 복구하라!', size=9.5, color=MUT)
tf2 = tb(L, y + Cm(0.05), W, Cm(0.7), MSO_ANCHOR.TOP)
p = para(tf2); p.alignment = PP_ALIGN.RIGHT
run(p, '이름 ____________', size=10, color=MUT)
y += Cm(1.45)

# ── 리본 ──────────────────────────────────────────────────────────
RIB = [('①빛', BLUE, C('FFFFFF')), ('②암호', MINT, C('FFFFFF')),
       ('③소리', SUN, C('5A3200')), ('④배송지', CORAL, C('FFFFFF'))]
gap = Cm(0.18); rw = int((W - gap * 3) / 4)
for i, (label, bg, fg) in enumerate(RIB):
    sh = box(L + i * (rw + gap), y, rw, Cm(0.72), fill=bg, line=None, radius=0.2)
    tfr = sh.text_frame; tfr.margin_left = tfr.margin_right = 0
    tfr.margin_top = tfr.margin_bottom = 0
    tfr.vertical_anchor = MSO_ANCHOR.MIDDLE
    pr = tfr.paragraphs[0]; pr.alignment = PP_ALIGN.CENTER
    pr.space_before = pr.space_after = Pt(0)
    run(pr, label, size=11, bold=True, color=fg)
y += Cm(0.92)

# ── 서사 ──────────────────────────────────────────────────────────
h = Cm(1.35)
box(L, y, W, h, fill=C('FFF3E0'), line=C('FFE0A3'), lw=2.0, radius=0.09)
tf = tb(L + Cm(0.3), y + Cm(0.1), W - Cm(0.6), h - Cm(0.2))
p = para(tf)
run(p, '☀️ ', size=10)
run(p, '긴급! 태양풍 경보!', size=10, bold=True)
run(p, ' GPS·통신이 교란되어 배송차가 길을 잃었어요. 이 차는 ', size=10)
run(p, '라이다로 벽을', size=10, bold=True)
run(p, ', ', size=10)
run(p, '빛(조도)으로 터널을', size=10, bold=True)
run(p, ' 봅니다. 아래 ', size=10)
run(p, '①~④', size=10, bold=True)
run(p, '의 빈칸을 채워 주행 코드를 복구하면, 태블릿에서 ', size=10)
run(p, '프로그램을 조립', size=10, bold=True)
run(p, '해 차가 ', size=10)
run(p, '스스로', size=10, bold=True)
run(p, ' 달려 배송을 완수합니다!', size=10)
y += h + Cm(0.22)

def step_card(top, height, title, tint, title_fg=C('FFFFFF'), tag='', title_w=Cm(7.6)):
    box(L, top, W, height, fill=None, line=LINE, lw=2.2, radius=0.06)
    hb = box(L + Cm(0.35), top + Cm(0.22), title_w, Cm(0.86), fill=tint, line=None, radius=0.22)
    t = hb.text_frame; t.word_wrap = False     # 접히면 알약이 두 줄이 된다
    t.margin_left = t.margin_right = 0
    t.margin_top = t.margin_bottom = 0; t.vertical_anchor = MSO_ANCHOR.MIDDLE
    pr = t.paragraphs[0]; pr.alignment = PP_ALIGN.CENTER
    pr.space_before = pr.space_after = Pt(0)
    run(pr, title, size=13, bold=True, color=title_fg)
    if tag:
        tt = tb(L, top + Cm(0.3), W - Cm(0.55), Cm(0.5), MSO_ANCHOR.TOP)
        pp = para(tt); pp.alignment = PP_ALIGN.RIGHT
        run(pp, tag, size=8.5, bold=True, color=C('B7A89A'))
    return top + Cm(1.18)

def bigbox(x, top, w, h, border, fill):
    return box(x, top, w, h, fill=fill, line=border, lw=2.4, radius=0.16)

def hintbar(x, top, w, h, lines):
    box(x, top, w, h, fill=C('F6FBFF'), line=C('D3E8FF'), lw=1.6, radius=0.1)
    tf = tb(x + Cm(0.28), top + Cm(0.08), w - Cm(0.56), h - Cm(0.16), MSO_ANCHOR.TOP)
    for i, segs in enumerate(lines):
        p = para(tf, i == 0)
        for txt, bold in segs:
            run(p, txt, size=9, bold=bold, color=C('5578A8'))

# ── ① 빛 ─────────────────────────────────────────────────────────
H1 = Cm(5.5)
cy = step_card(y, H1, '① 빛 — 터널 기준 만들기', BLUE, tag='센서 → 수학', title_w=Cm(7.9))
cy += Cm(0.25)
tf = tb(L + Cm(0.5), cy, W - Cm(1.0), Cm(0.9))
p = para(tf)
run(p, '🔆 밝은 곳 조도 = ', size=13); blank(p, 9, 13)
run(p, '      🕳️ 터널 안 조도 = ', size=13); blank(p, 9, 13)
cy += Cm(1.15)
tf = tb(L + Cm(0.5), cy, W - Cm(1.0), Cm(1.0))
p = para(tf)
run(p, '→ ', size=13)
run(p, '터널 기준', size=13, bold=True)
run(p, ' = ( ', size=13); blank(p, 5, 13)
run(p, ' ＋ ', size=13); blank(p, 5, 13)
run(p, ' ) ÷ ', size=13); blank(p, 3, 13)
run(p, ' = ', size=13)
bigbox(L + Cm(10.9), cy + Cm(0.02), Cm(3.4), Cm(0.95), MINT, C('EFFBF6'))
cy += Cm(1.35)
hintbar(L + Cm(0.4), cy, W - Cm(0.8), Cm(2.05), [
    [('💡 나누는 수는 ', False), ('태블릿 화면의 수', True), ('를 그대로 써요(보통 2 = 평균).', False)],
    [('— 왜 두 값의 ', False), ('사이', True), ('여야 잘 맞을까요? 한 문장으로:', False)],
    [(' ' * 78, False)],
])
# 한 문장 쓰는 줄 — 밑줄
ln = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, L + Cm(0.7), cy + Cm(1.6), W - Cm(1.4), Pt(1.2))
ln.fill.solid(); ln.fill.fore_color.rgb = C('AFC6E2'); ln.line.fill.background(); ln.shadow.inherit = False
y += H1 + Cm(0.2)

# ── ② 암호 ───────────────────────────────────────────────────────
H2 = Cm(4.5)
cy = step_card(y, H2, '② 암호 — 주행 코드 복구', MINT, tag='학년별 수학 문제', title_w=Cm(7.9))
cy += Cm(0.25)
tf = tb(L + Cm(0.5), cy, W - Cm(1.0), Cm(0.95))
p = para(tf)
run(p, '내가 푼 문제: ', size=13); blank(p, 20, 13)
run(p, '   정답 = ', size=13); run(p, '복구 코드', size=13, bold=True)
bigbox(L + Cm(15.2), cy + Cm(0.02), Cm(3.0), Cm(0.95), GRAPE, C('F6F1FF'))
cy += Cm(1.2)
tf = tb(L + Cm(0.5), cy, W - Cm(1.0), Cm(0.4), MSO_ANCHOR.TOP)
p = para(tf); run(p, '✏️ 계산 과정', size=8.5, color=C('B7A89A'))
cy += Cm(0.42)
wk = box(L + Cm(0.4), cy, W - Cm(0.8), Cm(1.75), fill=C('FFFDF8'), line=C('CDBFAE'), lw=1.6, radius=0.1)
wk.line.dash_style = MSO_LINE_DASH_STYLE.DASH   # 점선
y += H2 + Cm(0.2)

# ── ③ 소리 ───────────────────────────────────────────────────────
H3 = Cm(5.0)
cy = step_card(y, H3, '③ 소리 미션', SUN, title_fg=C('5A3200'), tag='터널 소리', title_w=Cm(5.0))
cy += Cm(0.3)
tf = tb(L + Cm(0.5), cy, W - Cm(1.0), Cm(0.95))
p = para(tf)
run(p, '계이름 ', size=13); blank(p, 5, 13)
run(p, ' · ', size=13); blank(p, 5, 13)
run(p, ' 을(를) ', size=13); run(p, '반복', size=13, bold=True)
bigbox(L + Cm(8.9), cy + Cm(0.02), Cm(2.8), Cm(0.95), SUN, C('FFF8EC'))
tf2 = tb(L + Cm(12.0), cy, Cm(2.0), Cm(0.95))
p = para(tf2); run(p, '번', size=13)
cy += Cm(1.35)
# 계이름 — 진짜 표(칸을 고치기 쉽게)
notes = ['도', '레', '미', '파', '솔', '라', '시', '높은도']
gt = slide.shapes.add_table(1, 8, L + Cm(0.4), cy, W - Cm(0.8), Cm(0.95)).table
for i, n in enumerate(notes):
    cell = gt.cell(0, i)
    cell.fill.solid(); cell.fill.fore_color.rgb = C('FFF8EC')
    cell.margin_left = cell.margin_right = 0
    cell.margin_top = cell.margin_bottom = Pt(1)
    pr = cell.text_frame.paragraphs[0]; pr.alignment = PP_ALIGN.CENTER
    run(pr, n, size=12)
cy += Cm(1.25)
hintbar(L + Cm(0.4), cy, W - Cm(0.8), Cm(0.95), [
    [('🎵 고른 두 계이름에 ○표! 앱의 ', False), ('▶듣기', True),
     ('로 소리를 미리 들어봐요. ', False), ('반복은 최대 10번', True), ('까지.', False)],
])
y += H3 + Cm(0.2)

# ── ④ 배송지 ─────────────────────────────────────────────────────
H4 = Cm(6.35)
cy = step_card(y, H4, '④ 배송지 — 문제 풀고 문자 얻기', CORAL, tag='배송 계산 → 문자', title_w=Cm(9.4))
cy += Cm(0.25)
tf = tb(L + Cm(0.5), cy, W - Cm(1.0), Cm(0.75))
p = para(tf)
run(p, '🚚 배송 문제를 풀어 ', size=12); run(p, '상자 수', size=12, bold=True)
run(p, '를 구하고, 아래 표에서 ', size=12); run(p, '문자', size=12, bold=True)
run(p, '를 찾아요.', size=12)
cy += Cm(0.95)
tf = tb(L + Cm(0.5), cy, W - Cm(1.0), Cm(0.95))
p = para(tf); run(p, '상자 수 = ', size=13)
bigbox(L + Cm(2.9), cy + Cm(0.02), Cm(2.8), Cm(0.95), CORAL, C('FFF2F1'))
tf2 = tb(L + Cm(6.1), cy, Cm(6.0), Cm(0.95))
p = para(tf2); run(p, '→  배송지 문자 = ', size=13)
bigbox(L + Cm(10.7), cy + Cm(0.02), Cm(2.6), Cm(0.95), MINT, C('EFFBF6'))
cy += Cm(1.3)
# 배송지 표 — 진짜 표
rows = [['상자 수', '12', '15', '18', '20', '24'],
        ['배송 구역', '북부', '서부', '동부', '남부', '중앙'],
        ['문자', 'N', 'W', 'E', 'S', 'D']]
tbl = slide.shapes.add_table(3, 6, L + Cm(0.4), cy, W - Cm(0.8), Cm(2.55)).table
tbl.columns[0].width = Cm(3.6)
rest = int((W - Cm(0.8) - Cm(3.6)) / 5)
for i in range(1, 6):
    tbl.columns[i].width = Emu(rest)
for r, rowvals in enumerate(rows):
    tbl.rows[r].height = Cm(0.85)
    for c, v in enumerate(rowvals):
        cell = tbl.cell(r, c)
        cell.fill.solid()
        cell.fill.fore_color.rgb = C('FFF3E0') if c == 0 else C('FFFFFF')
        cell.margin_top = cell.margin_bottom = Pt(1)
        cell.vertical_anchor = MSO_ANCHOR.MIDDLE
        pr = cell.text_frame.paragraphs[0]; pr.alignment = PP_ALIGN.CENTER
        run(pr, v, size=12.5, bold=(r == 2 and c > 0) or c == 0,
            color=MUT if c == 0 else INK)
y += H4 + Cm(0.25)

# ── 꼬리말 ────────────────────────────────────────────────────────
tf = tb(L, y, W, Cm(0.7), MSO_ANCHOR.TOP)
p = para(tf); p.alignment = PP_ALIGN.CENTER
run(p, '①~④를 다 채웠으면 태블릿에서 ', size=8.5, color=MUT)
run(p, '⑤ 프로그램 조립 → ⑥ 출발!', size=8.5, bold=True, color=MUT)
run(p, ' · 수학SW체험활동 · 경남수학문화관 ✏️🤖', size=8.5, color=MUT)

out = os.path.join(os.path.dirname(__file__), '..', 'docs', '학생_활동지.pptx')
PRS.save(os.path.abspath(out))
print('저장:', os.path.abspath(out))
print('마지막 요소 아래끝: %.2f cm / A4 높이 29.7 cm' % (Emu(y + Cm(0.7)).cm))
