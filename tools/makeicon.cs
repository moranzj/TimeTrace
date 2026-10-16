// makeicon.cs - 生成「时迹」图标：深色圆角底 + 青紫渐变计时环 + 发光圆点（icon-lab 方案①定稿）
// 重要：非 256px 尺寸使用经典 BMP(DIB) 条目（PNG 压缩条目在 Explorer 中兼容性差，
//       曾经导致桌面图标不刷新/不渲染）；只有 256x256 用 PNG（标准做法）。
// 构建：csc.exe /nologo /target:exe /out:makeicon.exe makeicon.cs /r:System.dll /r:System.Drawing.dll
// 运行：makeicon.exe ..\assets\timetrace.ico ..\assets\activity-preview.png（预览 = 各尺寸横排图）
using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;

static class MakeIcon
{
    static void Main(string[] args)
    {
        // --png <目录>：输出 16–1024 全套 PNG（供 macOS .icns / Linux 图标使用）
        if (args.Length >= 2 && args[0] == "--png")
        {
            string dir = args[1];
            Directory.CreateDirectory(dir);
            foreach (int s in new[] { 16, 32, 64, 128, 256, 512, 1024 })
            {
                using (var bmp = Render(s))
                    bmp.Save(Path.Combine(dir, "timetrace-" + s + ".png"), ImageFormat.Png);
            }
            Console.WriteLine("png set written: " + dir);
            return;
        }

        string outPath = args.Length > 0 ? args[0] : "timetrace.ico";
        string previewPath = args.Length > 1 ? args[1] : "";
        int[] sizes = { 256, 128, 64, 48, 32, 16 };
        var entries = new byte[sizes.Length][];
        for (int i = 0; i < sizes.Length; i++)
        {
            using (var bmp = Render(sizes[i]))
            {
                entries[i] = sizes[i] >= 256 ? ToPng(bmp) : ToDib(bmp);
            }
        }

        if (previewPath.Length > 0)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(previewPath)));
            using (var bmp = BuildPreview())
            {
                bmp.Save(previewPath, ImageFormat.Png);
            }
        }

        Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(outPath)));
        using (var bw = new BinaryWriter(File.Create(outPath)))
        {
            bw.Write((ushort)0);
            bw.Write((ushort)1);
            bw.Write((ushort)sizes.Length);
            int offset = 6 + 16 * sizes.Length;
            for (int i = 0; i < sizes.Length; i++)
            {
                bw.Write((byte)(sizes[i] >= 256 ? 0 : sizes[i]));
                bw.Write((byte)(sizes[i] >= 256 ? 0 : sizes[i]));
                bw.Write((byte)0);
                bw.Write((byte)0);
                bw.Write((ushort)1);
                bw.Write((ushort)32);
                bw.Write(entries[i].Length);
                bw.Write(offset);
                offset += entries[i].Length;
            }
            foreach (var e in entries) bw.Write(e);
        }
        Console.WriteLine("icon written: " + outPath);
    }

    // 预览图：16/32/48/64/128/256 横排（真实像素），便于检查小尺寸可读性
    static Bitmap BuildPreview()
    {
        int[] strip = { 16, 32, 48, 64, 128, 256 };
        int gap = 14, margin = 16, labelH = 22, maxH = 256;
        int w = margin * 2 + gap * (strip.Length - 1);
        foreach (var z in strip) w += z;
        int h = margin * 2 + maxH + labelH;
        var bmp = new Bitmap(w, h, PixelFormat.Format32bppArgb);
        using (var g = Graphics.FromImage(bmp))
        {
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.Clear(Color.FromArgb(255, 14, 19, 32));
            using (var f = new Font("Consolas", 11f))
            using (var fb = new SolidBrush(Color.FromArgb(255, 139, 149, 173)))
            using (var sf = new StringFormat { Alignment = StringAlignment.Center })
            {
                float x = margin;
                foreach (var z in strip)
                {
                    using (var ic = Render(z))
                        g.DrawImage(ic, x, margin + maxH - z, z, z);
                    g.DrawString(z + "px", f, fb, x + z / 2f, margin + maxH + 2, sf);
                    x += z + gap;
                }
            }
        }
        return bmp;
    }

    static Bitmap Render(int size)
    {
        var bmp = new Bitmap(size, size, PixelFormat.Format32bppArgb);
        using (var g = Graphics.FromImage(bmp))
        {
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.PixelOffsetMode = PixelOffsetMode.HighQuality;
            g.Clear(Color.Transparent);

            float s = size;
            float pad = s * 0.03125f;
            var full = new RectangleF(pad, pad, s - 2 * pad, s - 2 * pad);
            float radius = s * 0.2109f;

            // 深色圆角底 + 顶部微光 + 细边
            using (var gp = Rounded(full, radius))
            {
                using (var bg = new LinearGradientBrush(full, Color.FromArgb(255, 24, 31, 52), Color.FromArgb(255, 8, 11, 19), 90f))
                {
                    g.FillPath(bg, gp);
                }
                var st = g.Save();
                g.SetClip(gp, CombineMode.Replace);
                var sheen = new RectangleF(full.X, full.Y, full.Width, full.Height * 0.5f);
                using (var sh = new LinearGradientBrush(sheen, Color.FromArgb(26, 150, 190, 255), Color.FromArgb(0, 150, 190, 255), 90f))
                {
                    g.FillRectangle(sh, sheen);
                }
                g.Restore(st);
                using (var pen = new Pen(Color.FromArgb(36, 255, 255, 255), Math.Max(0.8f, s * 0.00625f)))
                {
                    g.DrawPath(pen, gp);
                }
            }

            // 计时环：30° 起、顺时针 300°，右侧留口；青 -> 紫渐变
            var cc = new PointF(s / 2f, s / 2f);
            float rad = s * 0.2969f;
            float stroke = Math.Max(s * 0.0586f, size <= 32 ? 2.6f : 0f);
            bool roundCaps = size >= 48;
            RingArc(g, cc, rad, 30f, 300f, stroke,
                Color.FromArgb(255, 56, 224, 255), Color.FromArgb(255, 150, 110, 255),
                Color.FromArgb(255, 110, 140, 255), roundCaps);

            double a0 = 30 * Math.PI / 180, a1 = 330 * Math.PI / 180;
            float sx = cc.X + (float)(rad * Math.Cos(a0)), sy = cc.Y + (float)(rad * Math.Sin(a0));
            float ex = cc.X + (float)(rad * Math.Cos(a1)), ey = cc.Y + (float)(rad * Math.Sin(a1));

            // 起点暗点（小尺寸省略）
            if (size >= 32)
            {
                float sr = Math.Max(s * 0.0156f, 1.4f);
                using (var b = new SolidBrush(Color.FromArgb(90, 160, 180, 220)))
                    g.FillEllipse(b, sx - sr, sy - sr, sr * 2, sr * 2);
            }

            // 终点亮圆点：双层光晕 + 柔和径向光 + 白芯
            float dr = Math.Max(s * 0.0352f, 2f);
            using (var b = new SolidBrush(Color.FromArgb(40, 120, 190, 255)))
                g.FillEllipse(b, ex - dr * 2.6f, ey - dr * 2.6f, dr * 5.2f, dr * 5.2f);
            using (var b = new SolidBrush(Color.FromArgb(70, 120, 190, 255)))
                g.FillEllipse(b, ex - dr * 1.7f, ey - dr * 1.7f, dr * 3.4f, dr * 3.4f);
            Glow(g, new PointF(ex, ey), dr * 3.6f, 46);
            using (var b = new SolidBrush(Color.FromArgb(255, 255, 240, 250)))
                g.FillEllipse(b, ex - dr, ey - dr, dr * 2, dr * 2);

            // 环心微点
            float cr = Math.Max(s * 0.0137f, 1f);
            using (var b = new SolidBrush(Color.FromArgb(120, 108, 140, 255)))
                g.FillEllipse(b, cc.X - cr, cc.Y - cr, cr * 2, cr * 2);
        }
        return bmp;
    }

    // 渐变描边圆弧：外发光两遍 + 48/24 段渐变色芯
    static void RingArc(Graphics g, PointF c, float rad, float startDeg, float sweepDeg, float stroke, Color c1, Color c2, Color tint, bool roundCaps)
    {
        float d = rad * 2f;
        using (var pen = new Pen(Color.FromArgb(16, tint), stroke * 2.6f))
        {
            pen.StartCap = LineCap.Round;
            pen.EndCap = LineCap.Round;
            g.DrawArc(pen, c.X - rad, c.Y - rad, d, d, startDeg, sweepDeg);
        }
        using (var pen = new Pen(Color.FromArgb(30, tint), stroke * 1.8f))
        {
            pen.StartCap = LineCap.Round;
            pen.EndCap = LineCap.Round;
            g.DrawArc(pen, c.X - rad, c.Y - rad, d, d, startDeg, sweepDeg);
        }
        int n = roundCaps ? 48 : 24;
        for (int i = 0; i < n; i++)
        {
            float t0 = i / (float)n, t1 = (i + 1) / (float)n;
            var col = Lerp(c1, c2, (t0 + t1) / 2f);
            using (var pen = new Pen(col, stroke))
            {
                if (roundCaps)
                {
                    pen.StartCap = LineCap.Round;
                    pen.EndCap = LineCap.Round;
                }
                float ov = roundCaps ? 0.6f : 1.4f;
                g.DrawArc(pen, c.X - rad, c.Y - rad, d, d, startDeg + sweepDeg * t0, sweepDeg * (t1 - t0) + ov);
            }
        }
    }

    static Color Lerp(Color a, Color b, float t)
    {
        return Color.FromArgb(
            (int)(a.A + (b.A - a.A) * t),
            (int)(a.R + (b.R - a.R) * t),
            (int)(a.G + (b.G - a.G) * t),
            (int)(a.B + (b.B - a.B) * t));
    }

    // 径向柔光（中心 alpha -> 边缘 0）
    static void Glow(Graphics g, PointF c, float r, int alpha)
    {
        using (var path = new GraphicsPath())
        {
            path.AddEllipse(c.X - r, c.Y - r, r * 2, r * 2);
            using (var pgb = new PathGradientBrush(path))
            {
                pgb.CenterColor = Color.FromArgb(alpha, 64, 224, 255);
                pgb.SurroundColors = new[] { Color.FromArgb(0, 64, 224, 255) };
                g.FillPath(pgb, path);
            }
        }
    }

    static GraphicsPath Rounded(RectangleF r, float radius)
    {
        var gp = new GraphicsPath();
        float d = radius * 2;
        if (d > r.Width) d = r.Width;
        if (d > r.Height) d = r.Height;
        if (d < 1) d = 1;
        gp.AddArc(r.X, r.Y, d, d, 180, 90);
        gp.AddArc(r.Right - d, r.Y, d, d, 270, 90);
        gp.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
        gp.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
        gp.CloseFigure();
        return gp;
    }

    static byte[] ToPng(Bitmap bmp)
    {
        using (var ms = new MemoryStream())
        {
            bmp.Save(ms, ImageFormat.Png);
            return ms.ToArray();
        }
    }

    // 经典 ICO 内嵌 DIB：BITMAPINFOHEADER + 自下而上 BGRA 像素 + AND 掩码（全 0，靠 alpha 透明）
    static byte[] ToDib(Bitmap bmp)
    {
        int w = bmp.Width, h = bmp.Height;
        int maskStride = ((w + 31) / 32) * 4;
        var data = new byte[40 + w * h * 4 + maskStride * h];
        using (var ms = new MemoryStream(data))
        using (var bw = new BinaryWriter(ms))
        {
            bw.Write(40);
            bw.Write(w);
            bw.Write(h * 2);
            bw.Write((ushort)1);
            bw.Write((ushort)32);
            bw.Write(0);
            bw.Write(w * h * 4 + maskStride * h);
            bw.Write(0);
            bw.Write(0);
            bw.Write(0);
            bw.Write(0);
            var bd = bmp.LockBits(new Rectangle(0, 0, w, h), ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
            try
            {
                var row = new byte[bd.Stride];
                for (int y = h - 1; y >= 0; y--)
                {
                    Marshal.Copy(bd.Scan0 + y * bd.Stride, row, 0, bd.Stride);
                    bw.Write(row, 0, w * 4);
                }
            }
            finally
            {
                bmp.UnlockBits(bd);
            }
            bw.Write(new byte[maskStride * h]);
        }
        return data;
    }
}
