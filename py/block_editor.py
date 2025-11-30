import sys
import os
import re
from PySide6.QtWidgets import (QApplication, QMainWindow, QWidget, QVBoxLayout, QHBoxLayout,
                               QListWidget, QGroupBox, QFormLayout, QLineEdit, QCheckBox,
                               QPushButton, QLabel, QScrollArea, QFileDialog, QSplitter,
                               QMessageBox, QGridLayout, QToolButton)
from PySide6.QtCore import Qt, Signal, QSize
from PySide6.QtGui import QPixmap, QPainter, QPen, QColor, QIcon

# --- КОНФИГУРАЦИЯ ПУТЕЙ ---
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SCRIPT_DIR)
CONSTANTS_PATH = os.path.join(PROJECT_ROOT, "js", "constants.js")
ATLAS_PATH = os.path.join(PROJECT_ROOT, "assets", "atlas.png")

# Настройки атласа
ATLAS_SIZE = 1024
GRID_SIZE = 16
TILE_SIZE = ATLAS_SIZE // GRID_SIZE  # 64px

# Пресеты звуков
SOUND_PRESETS = {
    "NONE": {"step": "", "break": "", "place": ""},
    "STONE": {"step": "stone_step", "break": "stone_break", "place": "stone_place"},
    "WOOD": {"step": "wood_step", "break": "wood_break", "place": "wood_place"},
    "GRASS": {"step": "grass_step", "break": "grass_break", "place": "grass_place"},
    "DIRT": {"step": "dirt_step", "break": "dirt_break", "place": "dirt_place"},
}


class AtlasWidget(QLabel):
    clicked = Signal(int, int)

    def __init__(self):
        super().__init__()
        self.setMouseTracking(True)
        self.selected_cell = (0, 0)
        self.atlas_pixmap = None
        self.setAlignment(Qt.AlignmentFlag.AlignTop | Qt.AlignmentFlag.AlignLeft)
        self.setStyleSheet("background-color: #222;")  # Темный фон

    def load_atlas(self):
        if os.path.exists(ATLAS_PATH):
            self.atlas_pixmap = QPixmap(ATLAS_PATH)
            self.draw_grid()
        else:
            self.setText("Atlas not found!")

    def draw_grid(self):
        if not self.atlas_pixmap: return

        displayed = self.atlas_pixmap.copy()
        painter = QPainter(displayed)

        # Сетка (полупрозрачная)
        pen = QPen(QColor(0, 255, 255, 50))
        pen.setWidth(1)
        painter.setPen(pen)

        for i in range(GRID_SIZE + 1):
            pos = i * TILE_SIZE
            painter.drawLine(pos, 0, pos, ATLAS_SIZE)
            painter.drawLine(0, pos, ATLAS_SIZE, pos)

        # Выделение (Красный квадрат)
        sel_pen = QPen(QColor(255, 50, 50, 255))
        sel_pen.setWidth(3)
        painter.setPen(sel_pen)
        cx, cy = self.selected_cell
        painter.drawRect(cx * TILE_SIZE, cy * TILE_SIZE, TILE_SIZE, TILE_SIZE)

        painter.end()
        self.setPixmap(displayed)

    def mousePressEvent(self, event):
        if not self.atlas_pixmap: return
        x = event.position().x()
        y = event.position().y()
        col = int(x // TILE_SIZE)
        row = int(y // TILE_SIZE)

        if 0 <= col < GRID_SIZE and 0 <= row < GRID_SIZE:
            self.selected_cell = (col, row)
            self.draw_grid()
            self.clicked.emit(col, row)

    def set_selection(self, col, row):
        self.selected_cell = (col, row)
        self.draw_grid()

    def get_tile_pixmap(self, col, row):
        """Вырезает кусочек текстуры"""
        if not self.atlas_pixmap: return QPixmap(64, 64)
        return self.atlas_pixmap.copy(col * TILE_SIZE, row * TILE_SIZE, TILE_SIZE, TILE_SIZE)


class MainWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("Minecraft AI - Pro Block Editor")
        self.resize(1400, 850)

        self.blocks = []
        self.current_block = None
        self.is_loading = False
        self.active_texture_target = 'atlas'
        self.tex_widgets = {}  # Словарь виджетов текстур

        try:
            from PIL import Image
            self.has_pil = True
        except ImportError:
            self.has_pil = False
            print("Pillow not installed.")

        self.init_ui()
        self.load_data()

    def init_ui(self):
        main_widget = QWidget()
        self.setCentralWidget(main_widget)

        # --- ИСПРАВЛЕНИЕ: Убрали создание лишнего лейаута здесь ---

        # --- LEFT: LIST ---
        left_layout = QVBoxLayout()
        left_layout.addWidget(QLabel("<b>BLOCKS</b>"))

        self.list_widget = QListWidget()
        self.list_widget.currentRowChanged.connect(self.on_block_selected)
        left_layout.addWidget(self.list_widget)

        btn_add = QPushButton("+ Add")
        btn_add.clicked.connect(self.add_block)
        btn_del = QPushButton("- Del")
        btn_del.clicked.connect(self.delete_block)

        h_btns = QHBoxLayout()
        h_btns.addWidget(btn_add)
        h_btns.addWidget(btn_del)
        left_layout.addLayout(h_btns)

        left_container = QWidget()
        left_container.setLayout(left_layout)
        left_container.setMaximumWidth(220)

        # --- CENTER: PROPERTIES ---
        center_scroll = QScrollArea()
        center_scroll.setWidgetResizable(True)
        center_widget = QWidget()
        self.center_layout = QVBoxLayout(center_widget)
        center_scroll.setWidget(center_widget)

        # 1. Basic Info
        gb_basic = QGroupBox("Basic Information")
        form_basic = QFormLayout()
        self.inp_id = QLineEdit()
        self.inp_id.textChanged.connect(self.update_current_block)
        self.inp_name = QLineEdit()
        self.inp_name.textChanged.connect(self.update_current_block)
        form_basic.addRow("ID:", self.inp_id)
        form_basic.addRow("Name:", self.inp_name)
        gb_basic.setLayout(form_basic)
        self.center_layout.addWidget(gb_basic)

        # 2. Textures (Grid Layout)
        gb_tex = QGroupBox("Textures")
        self.tex_grid = QGridLayout()
        self.tex_grid.setColumnStretch(1, 1)  # Path field stretches

        # Headers
        self.tex_grid.addWidget(QLabel("Face"), 0, 0)
        self.tex_grid.addWidget(QLabel("Path / Coordinates"), 0, 1)
        self.tex_grid.addWidget(QLabel("Pick"), 0, 2)
        self.tex_grid.addWidget(QLabel("Preview"), 0, 3)
        self.tex_grid.addWidget(QLabel("Reset"), 0, 4)

        # Создаем строки для каждой грани
        self.create_texture_row("Side (All)", "atlas", 1)
        self.create_texture_row("Top", "atlasTop", 2)
        self.create_texture_row("Bottom", "atlasBottom", 3)

        gb_tex.setLayout(self.tex_grid)
        self.center_layout.addWidget(gb_tex)

        # 3. Sounds
        gb_sound = QGroupBox("Sounds")
        v_sound = QVBoxLayout()
        h_presets = QHBoxLayout()
        for name in SOUND_PRESETS:
            btn = QPushButton(name)
            btn.setFixedSize(50, 25)
            btn.clicked.connect(lambda _, n=name: self.apply_sound_preset(n))
            h_presets.addWidget(btn)
        h_presets.addStretch()
        v_sound.addLayout(h_presets)

        form_sound = QFormLayout()
        self.inp_snd_step = QLineEdit()
        self.inp_snd_break = QLineEdit()
        self.inp_snd_place = QLineEdit()

        for inp in [self.inp_snd_step, self.inp_snd_break, self.inp_snd_place]:
            inp.textChanged.connect(self.update_current_block)

        form_sound.addRow("Step:", self.inp_snd_step)
        form_sound.addRow("Break:", self.inp_snd_break)
        form_sound.addRow("Place:", self.inp_snd_place)
        v_sound.addLayout(form_sound)
        gb_sound.setLayout(v_sound)
        self.center_layout.addWidget(gb_sound)

        # 4. Properties
        gb_props = QGroupBox("Properties")
        v_props = QVBoxLayout()
        self.chk_solid = QCheckBox("Solid (Collidable)")
        self.chk_trans = QCheckBox("Transparent (Glass/Leaves)")
        self.chk_solid.clicked.connect(self.update_current_block)
        self.chk_trans.clicked.connect(self.update_current_block)
        v_props.addWidget(self.chk_solid)
        v_props.addWidget(self.chk_trans)
        gb_props.setLayout(v_props)
        self.center_layout.addWidget(gb_props)

        self.center_layout.addStretch()

        # --- RIGHT: ATLAS (Initially Hidden) ---
        self.right_container = QWidget()
        right_layout = QVBoxLayout(self.right_container)

        self.lbl_atlas_title = QLabel("Texture Atlas")
        self.lbl_atlas_title.setStyleSheet("font-size: 14px; font-weight: bold; color: #555;")
        right_layout.addWidget(self.lbl_atlas_title)

        self.atlas_scroll = QScrollArea()
        self.atlas_widget = AtlasWidget()
        self.atlas_widget.clicked.connect(self.on_atlas_clicked)
        self.atlas_scroll.setWidget(self.atlas_widget)
        self.atlas_scroll.setWidgetResizable(True)
        right_layout.addWidget(self.atlas_scroll)

        self.lbl_atlas_info = QLabel("Click on a tile to assign it.")
        self.lbl_atlas_info.setStyleSheet("color: gray;")
        right_layout.addWidget(self.lbl_atlas_info)

        # --- BOTTOM ---
        bottom_layout = QHBoxLayout()
        self.btn_save_file = QPushButton("💾 SAVE CONSTANTS.JS")
        self.btn_save_file.setFixedHeight(50)
        self.btn_save_file.setStyleSheet("background-color: #4CAF50; color: white; font-size: 16px; font-weight: bold;")
        self.btn_save_file.clicked.connect(self.save_to_file)
        bottom_layout.addWidget(self.btn_save_file)

        # --- ASSEMBLY ---
        splitter = QSplitter(Qt.Orientation.Horizontal)
        splitter.addWidget(left_container)
        splitter.addWidget(center_scroll)
        splitter.addWidget(self.right_container)

        splitter.setStretchFactor(1, 0)
        splitter.setStretchFactor(2, 1)

        # --- ИСПРАВЛЕНИЕ: Создаем единый лейаут и назначаем его ОДИН раз ---
        layout_wrapper = QVBoxLayout()
        layout_wrapper.addWidget(splitter)
        layout_wrapper.addLayout(bottom_layout)

        main_widget.setLayout(layout_wrapper)

        # Загрузка
        self.atlas_widget.load_atlas()
        self.right_container.setVisible(False)

    def create_texture_row(self, label_text, key_prefix, row_idx):
        """Создает строку управления текстурой"""

        # 1. Label
        self.tex_grid.addWidget(QLabel(label_text), row_idx, 0)

        # 2. Path
        line_path = QLineEdit()
        line_path.setPlaceholderText("Atlas [0, 0]")
        line_path.setReadOnly(True)  # Чтобы руками не ломали формат
        self.tex_grid.addWidget(line_path, row_idx, 1)

        # 3. Pick Button
        btn_pick = QToolButton()
        btn_pick.setText("🔍")
        btn_pick.setToolTip(f"Pick from Atlas for {label_text}")
        btn_pick.clicked.connect(lambda: self.activate_atlas_picking(key_prefix))
        self.tex_grid.addWidget(btn_pick, row_idx, 2)

        # 4. Preview / Upload Button
        btn_preview = QToolButton()
        btn_preview.setIconSize(QSize(48, 48))
        btn_preview.setFixedSize(54, 54)
        btn_preview.setToolTip("Click to load texture from file...")
        btn_preview.clicked.connect(lambda: self.upload_texture_for_face(key_prefix))
        self.tex_grid.addWidget(btn_preview, row_idx, 3)

        # 5. Reset Button
        btn_reset = QToolButton()
        btn_reset.setText("✖")
        btn_reset.setToolTip("Reset to Default")
        btn_reset.clicked.connect(lambda: self.reset_texture_face(key_prefix))
        self.tex_grid.addWidget(btn_reset, row_idx, 4)

        # Store widgets
        self.tex_widgets[key_prefix] = {
            "path": line_path,
            "preview": btn_preview,
            "reset": btn_reset
        }

    # --- LOGIC ---

    def activate_atlas_picking(self, key_prefix):
        self.active_texture_target = key_prefix

        # Сброс стилей
        for k, w in self.tex_widgets.items():
            w["preview"].setStyleSheet("")

        # Подсветка активного
        self.tex_widgets[key_prefix]["preview"].setStyleSheet("border: 3px solid #2196F3;")
        self.right_container.setVisible(True)

    def upload_texture_for_face(self, key_prefix):
        if not self.has_pil:
            QMessageBox.critical(self, "Error", "Pillow not installed")
            return

        file_path, _ = QFileDialog.getOpenFileName(self, "Select Texture", "", "Images (*.png *.jpg *.jpeg)")
        if not file_path: return

        from PIL import Image

        try:
            img = Image.open(file_path)
            img = img.resize((TILE_SIZE, TILE_SIZE), Image.Resampling.NEAREST)

            # Берем координаты из выделения на атласе (или [0,0] если ничего не выбрано)
            col, row = self.atlas_widget.selected_cell

            if os.path.exists(ATLAS_PATH):
                atlas = Image.open(ATLAS_PATH)
            else:
                atlas = Image.new("RGBA", (ATLAS_SIZE, ATLAS_SIZE), (0, 0, 0, 0))

            atlas.paste(img, (col * TILE_SIZE, row * TILE_SIZE))
            atlas.save(ATLAS_PATH)

            self.atlas_widget.load_atlas()

            # Назначаем координаты блоку
            self.current_block[key_prefix] = [col, row]

            self.update_texture_ui_row(key_prefix)
            self.statusBar().showMessage(f"Uploaded texture to [{col},{row}]", 3000)

        except Exception as e:
            QMessageBox.critical(self, "Error", str(e))

    def reset_texture_face(self, key_prefix):
        if not self.current_block: return

        if key_prefix == 'atlas':
            self.current_block['atlas'] = [0, 0]
        else:
            self.current_block[key_prefix] = None

        self.update_texture_ui_row(key_prefix)

    def on_atlas_clicked(self, col, row):
        if not self.current_block: return

        target = self.active_texture_target
        self.current_block[target] = [col, row]
        self.update_texture_ui_row(target)

    def update_texture_ui_row(self, key_prefix):
        if not self.current_block: return

        val = self.current_block.get(key_prefix)
        widgets = self.tex_widgets[key_prefix]

        # Path text
        if val:
            widgets["path"].setText(f"Atlas {val}")
        else:
            widgets["path"].setText("Inherits Side")

        # Reset button
        if key_prefix == 'atlas':
            widgets["reset"].setVisible(val != [0, 0])
        else:
            widgets["reset"].setVisible(val is not None)

        # Preview Icon
        if val:
            pix = self.atlas_widget.get_tile_pixmap(val[0], val[1])
            widgets["preview"].setIcon(QIcon(pix))
        else:
            # Show side texture but dimmed
            base_val = self.current_block.get('atlas', [0, 0])
            pix = self.atlas_widget.get_tile_pixmap(base_val[0], base_val[1])
            img = pix.toImage()
            # Затемняем
            p = QPainter(img)
            p.fillRect(img.rect(), QColor(0, 0, 0, 100))
            p.end()
            widgets["preview"].setIcon(QIcon(QPixmap.fromImage(img)))

    def on_block_selected(self, row):
        if row < 0:
            self.right_container.setVisible(False)
            return

        self.is_loading = True
        self.current_block = self.blocks[row]
        b = self.current_block

        self.right_container.setVisible(True)
        self.lbl_atlas_title.setText(f"Texture Atlas - Editing: {b['name']}")

        self.inp_id.setText(str(b['id']))
        self.inp_name.setText(b['name'])
        self.chk_solid.setChecked(b['solid'])
        self.chk_trans.setChecked(b['transparent'])

        s = b['sound'] or {}
        self.inp_snd_step.setText(s.get('step', ''))
        self.inp_snd_break.setText(s.get('break', ''))
        self.inp_snd_place.setText(s.get('place', ''))

        # Reset selection mode to Side
        self.active_texture_target = 'atlas'
        for k in ['atlas', 'atlasTop', 'atlasBottom']:
            self.update_texture_ui_row(k)
            # Сброс подсветки
            self.tex_widgets[k]["preview"].setStyleSheet("")

        # Подсветка Side по умолчанию
        self.tex_widgets['atlas']["preview"].setStyleSheet("border: 3px solid #2196F3;")

        col, row = b['atlas']
        self.atlas_widget.set_selection(col, row)

        self.is_loading = False

    def update_current_block(self):
        if self.is_loading or not self.current_block: return
        b = self.current_block
        try:
            b['id'] = int(self.inp_id.text())
        except:
            pass
        b['name'] = self.inp_name.text()
        b['solid'] = self.chk_solid.isChecked()
        b['transparent'] = self.chk_trans.isChecked()

        step, brk, place = self.inp_snd_step.text(), self.inp_snd_break.text(), self.inp_snd_place.text()
        if step or brk or place:
            b['sound'] = {"step": step, "break": brk, "place": place}
        else:
            b['sound'] = None

        cur_item = self.list_widget.currentItem()
        if cur_item: cur_item.setText(f"[{b['id']}] {b['name']}")
        self.lbl_atlas_title.setText(f"Texture Atlas - Editing: {b['name']}")

    def apply_sound_preset(self, name):
        if not self.current_block: return
        p = SOUND_PRESETS[name]
        self.inp_snd_step.setText(p['step'])
        self.inp_snd_break.setText(p['break'])
        self.inp_snd_place.setText(p['place'])

    def add_block(self):
        nid = max((b['id'] for b in self.blocks), default=-1) + 1
        new_b = {"id": nid, "name": "NewBlock", "atlas": [0, 0], "atlasTop": None, "atlasBottom": None, "solid": True,
                 "transparent": False, "sound": None}
        self.blocks.append(new_b)
        self.list_widget.addItem(f"[{nid}] NewBlock")
        self.list_widget.setCurrentRow(len(self.blocks) - 1)

    def delete_block(self):
        row = self.list_widget.currentRow()
        if row >= 0:
            del self.blocks[row]
            self.list_widget.takeItem(row)
            self.current_block = None
            self.right_container.setVisible(False)

    def load_data(self):
        if not os.path.exists(CONSTANTS_PATH):
            QMessageBox.critical(self, "Error", f"File not found:\n{CONSTANTS_PATH}")
            return
        with open(CONSTANTS_PATH, "r", encoding="utf-8") as f:
            self.file_content = f.read()
        match = re.search(r"export const BLOCK_DATA = \[(.*?)\];", self.file_content, re.DOTALL)
        if match:
            self.blocks = self._parse_js_array(match.group(1))
            self.refresh_list()

    def _parse_js_array(self, raw_data):
        blocks = []
        items = re.findall(r"\{\s*id:.*?\}(?:,|\s*$)", raw_data, re.DOTALL)
        if not items: items = raw_data.split("},")
        for item in items:
            if "id:" not in item: continue
            b = {}

            def get_val(pattern, text, type_func=str):
                m = re.search(pattern, text)
                return type_func(m.group(1)) if m else None

            b["id"] = get_val(r"id:\s*(\d+)", item, int)
            b["name"] = get_val(r"name:\s*['\"](.*?)['\"]", item)
            m_atlas = re.search(r"atlas:\s*\[(\d+),\s*(\d+)\]", item)
            b["atlas"] = [int(m_atlas.group(1)), int(m_atlas.group(2))] if m_atlas else [0, 0]
            m_top = re.search(r"atlasTop:\s*\[(\d+),\s*(\d+)\]", item)
            b["atlasTop"] = [int(m_top.group(1)), int(m_top.group(2))] if m_top else None
            m_bot = re.search(r"atlasBottom:\s*\[(\d+),\s*(\d+)\]", item)
            b["atlasBottom"] = [int(m_bot.group(1)), int(m_bot.group(2))] if m_bot else None
            b["transparent"] = (get_val(r"transparent:\s*(true|false)", item) == "true")
            b["solid"] = (get_val(r"solid:\s*(true|false)", item) == "true")
            snd_match = re.search(r"sound:\s*\{(.*?)\}", item, re.DOTALL)
            if snd_match:
                raw_s = snd_match.group(1)
                b["sound"] = {"step": get_val(r"step:\s*['\"](.*?)['\"]", raw_s) or "",
                              "break": get_val(r"break:\s*['\"](.*?)['\"]", raw_s) or "",
                              "place": get_val(r"place:\s*['\"](.*?)['\"]", raw_s) or ""}
            else:
                b["sound"] = None
            blocks.append(b)
        blocks.sort(key=lambda x: x['id'])
        return blocks

    def save_to_file(self):
        js_str = "\n"
        for b in self.blocks:
            js_str += "    { \n"
            js_str += f"        id: {b['id']}, name: '{b['name']}', \n"
            js_str += f"        atlas: {b['atlas']}, \n"
            if b['atlasTop']: js_str += f"        atlasTop: {b['atlasTop']}, \n"
            if b['atlasBottom']: js_str += f"        atlasBottom: {b['atlasBottom']}, \n"
            js_str += f"        transparent: {str(b['transparent']).lower()}, \n"
            js_str += f"        solid: {str(b['solid']).lower()}, \n"
            if b['sound']:
                s = b["sound"]
                js_str += f"        sound: {{ step: '{s.get('step', '')}', break: '{s.get('break', '')}', place: '{s.get('place', '')}' }}\n"
            else:
                js_str += "        sound: null\n"
            js_str += "    },\n"
        new_content = re.sub(r"export const BLOCK_DATA = \[(.*?)\];", f"export const BLOCK_DATA = [{js_str}];",
                             self.file_content, flags=re.DOTALL)
        try:
            with open(CONSTANTS_PATH, "w", encoding="utf-8") as f:
                f.write(new_content)
            self.statusBar().showMessage("Saved successfully to constants.js", 3000)
        except Exception as e:
            QMessageBox.critical(self, "Save Error", str(e))

    def refresh_list(self):
        self.list_widget.clear()
        for b in self.blocks: self.list_widget.addItem(f"[{b['id']}] {b['name']}")


if __name__ == "__main__":
    app = QApplication(sys.argv)
    app.setStyle("Fusion")
    window = MainWindow()
    window.show()
    sys.exit(app.exec())