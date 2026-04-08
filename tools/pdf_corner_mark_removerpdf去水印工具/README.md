# pdf_corner_mark_remover

从 PDF 文件结构中**删除**每页右下角固定标记（例如“夸克扫描王 + 二维码”）。

约束：**不通过**加白色覆盖层遮挡；而是删除内容流里的绘制指令或移除注释对象。

## 安装

```powershell
cd d:\speak_echo\tools\pdf_corner_mark_remover
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

## 用法

### 先探测（推荐）

```powershell
python -m pdf_corner_mark_remover probe --in "D:\PDF处理\扫描件_第十级.pdf"
```

### 删除右下角标记

```powershell
python -m pdf_corner_mark_remover remove --in "D:\PDF处理\扫描件_第十级.pdf" --out "D:\PDF处理\扫描件_第十级.cleaned.pdf"
```

常用参数：
- `--margin-x-mm` / `--margin-y-mm`: 定义右下角区域（默认 60mm × 60mm）
- `--dry-run`: 只打印会删除的目标，不写出文件

## 验证方式

1) 运行 `--dry-run` 看命中对象（例如 `/QuarkX2x12`）。

```powershell
python -m pdf_corner_mark_remover remove --in "D:\PDF处理\扫描件_第十级.pdf" --out "D:\PDF处理\扫描件_第十级.cleaned.pdf" --dry-run
```

2) 打开输出 PDF，确认右下角标记消失且正文不受影响。

## 失败/限制

- 如果整页是单张大图（右下角标记被“烘焙”进像素里），就没有可独立删除的对象；脚本会提示找不到可删除目标。

