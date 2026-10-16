// icon-lab.cs - render candidate icon designs for review (preview only, 6 styles).
// Build: csc /nologo /target:exe /out:icon-lab.exe icon-lab.cs /r:System.dll /r:System.Drawing.dll
// Run:   icon-lab.exe <outDir>
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Drawing.Text;
using System.IO;

static class IconLab
{
    const float S = 256f;

    static void Main(string[] args)
    {
        string outDir = args.Length > 0 ? args[0] : ".";
        Directory.CreateDirectory(outDir);

        string[] names = { "1-ring", "2-glyph", "3-hourglass", "4-comet", "5-gold", "6-eye" };
        string[] labels = { "\u2460 \u65f6\u73af", "\u2461 \u65f6\u5b57", "\u2462 \u6c99\u6f0f", "\u2463 \u6d41\u661f", "\u2464 \u91d1\u73af", "\u2465 \u6781\u7b80\u773c" };
        Action<Graphics>[] drawers = { DrawRing, DrawGlyph, DrawHourglass, DrawComet, DrawGold, DrawEye };

        var shots = new Bitmap[drawers.Length];
        for (int i = 0; i < drawers.Length; i++)
        {
            shots[i] = Render(drawers[i], 512);
            shots[i].Save(Path.Combine(outDir, "icon-" + names[i] + ".png"), ImageFormat.Png);
        }
        MakeSheet(shots, labels, Path.Combine(outDir, "icon-sheet.png"));
        Console.WriteLine("saved 6 icons + sheet to " + outDir);
    }

    static Bitmap Render(Action<Graphics> draw, int size)
    {
        var bmp = new Bitmap(size, size, PixelFormat.Format32bppArgb);
        using (var g = Graphics.FromImage(bmp))
        {
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.InterpolationMode = InterpolationMode.HighQualityBicubic;
            g.PixelOffsetMode = PixelOffsetMode.HighQuality;
            g.TextRenderingHint = TextRenderingHint.AntiAliasGridFit;
            float k = size / S;
            g.ScaleTransform(k, k);
            draw(g);
        }
        return bmp;
    }

    static void MakeSheet(Bitmap[] shots, string[] labels, string path)
    {
        int cell = 420, gap = 36, margin = 36, lab = 56, cols = 3;
        int rows = (shots.Length + cols - 1) / cols;
        int w = margin * 2 + cols * cell + (cols - 1) * gap;
        int h = margin * 2 + rows * (cell + lab) + (rows - 1) * gap;
        using (var bmp = new Bitmap(w, h, PixelFormat.Format32bppArgb))
        using (var g = Graphics.FromImage(bmp))
        {
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.TextRenderingHint = TextRenderingHint.AntiAliasGridFit;
            using (var bg = new LinearGradientBrush(new RectangleF(0, 0, w, h), CA(255, 13, 17, 28), CA(255, 8, 10, 18), 90f))
                g.FillRectangle(bg, 0, 0, w, h);
            using (var f = new Font("Microsoft YaHei", 26, FontStyle.Bold))
            using (var fb = new SolidBrush(CA(255, 201, 212, 240)))
            using (var sf = new StringFormat { Alignment = StringAlignment.Center })
            {
                for (int i = 0; i < shots.Length; i++)
                {
                    int col = i % cols, row = i / cols;
                    float x = margin + col * (cell + gap);
                    float y = margin + row * (cell + lab + gap);
                    g.DrawImage(shots[i], x, y, cell, cell);
                    g.DrawString(labels[i], f, fb, x + cell / 2f, y + cell + 8, sf);
                }
            }
            bmp.Save(path, ImageFormat.Png);
        }
    }

    // ---------- helpers ----------

    static Color CA(int a, int r, int g, int b) { return Color.FromArgb(a, r, g, b); }
    static Color C(int r, int g, int b) { return Color.FromArgb(255, r, g, b); }

    static Color Lerp(Color a, Color b, float t)
    {
        return Color.FromArgb(
            (int)(a.A + (b.A - a.A) * t),
            (int)(a.R + (b.R - a.R) * t),
            (int)(a.G + (b.G - a.G) * t),
            (int)(a.B + (b.B - a.B) * t));
    }

    static Color Wheel(Color[] cols, float t)
    {
        float x = t * (cols.Length - 1);
        int i = (int)x;
        if (i >= cols.Length - 1) i = cols.Length - 2;
        return Lerp(cols[i], cols[i + 1], x - i);
    }

    static GraphicsPath RoundRect(RectangleF r, float rad)
    {
        var p = new GraphicsPath();
        float d = rad * 2;
        p.AddArc(r.X, r.Y, d, d, 180, 90);
        p.AddArc(r.Right - d, r.Y, d, d, 270, 90);
        p.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
        p.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
        p.CloseFigure();
        return p;
    }

    static void Base(Graphics g)
    {
        var r = new RectangleF(8, 8, 240, 240);
        using (var path = RoundRect(r, 54))
        {
            using (var bg = new LinearGradientBrush(r, CA(255, 24, 31, 52), CA(255, 8, 11, 19), 90f))
                g.FillPath(bg, path);
            var old = g.Save();
            g.SetClip(path, CombineMode.Replace);
            using (var sheen = new LinearGradientBrush(new RectangleF(8, 8, 240, 130), CA(26, 150, 190, 255), CA(0, 150, 190, 255), 90f))
                g.FillRectangle(sheen, 8, 8, 240, 130);
            g.Restore(old);
            using (var pen = new Pen(CA(36, 255, 255, 255), 1.6f))
                g.DrawPath(pen, path);
        }
    }

    static void ArcGradient(Graphics g, float cx, float cy, float rad, float startDeg, float sweepDeg, float width, Color c1, Color c2, Color glowTint)
    {
        using (var pen = new Pen(CA(16, glowTint.R, glowTint.G, glowTint.B), width * 2.6f))
        {
            pen.StartCap = LineCap.Round; pen.EndCap = LineCap.Round;
            g.DrawArc(pen, cx - rad, cy - rad, rad * 2, rad * 2, startDeg, sweepDeg);
        }
        using (var pen = new Pen(CA(30, glowTint.R, glowTint.G, glowTint.B), width * 1.8f))
        {
            pen.StartCap = LineCap.Round; pen.EndCap = LineCap.Round;
            g.DrawArc(pen, cx - rad, cy - rad, rad * 2, rad * 2, startDeg, sweepDeg);
        }
        int n = 48;
        for (int i = 0; i < n; i++)
        {
            float t0 = i / (float)n, t1 = (i + 1) / (float)n;
            var col = Lerp(c1, c2, (t0 + t1) / 2f);
            using (var pen = new Pen(col, width))
            {
                pen.StartCap = LineCap.Round; pen.EndCap = LineCap.Round;
                g.DrawArc(pen, cx - rad, cy - rad, rad * 2, rad * 2, startDeg + sweepDeg * t0, sweepDeg * (t1 - t0) + 0.6f);
            }
        }
    }

    static void GlowDot(Graphics g, float cx, float cy, float r, Color core, Color halo)
    {
        using (var b = new SolidBrush(CA(40, halo.R, halo.G, halo.B))) g.FillEllipse(b, cx - r * 2.6f, cy - r * 2.6f, r * 5.2f, r * 5.2f);
        using (var b = new SolidBrush(CA(70, halo.R, halo.G, halo.B))) g.FillEllipse(b, cx - r * 1.7f, cy - r * 1.7f, r * 3.4f, r * 3.4f);
        using (var b = new SolidBrush(core)) g.FillEllipse(b, cx - r, cy - r, r * 2, r * 2);
    }

    static PointF Bez(PointF p0, PointF p1, PointF p2, PointF p3, float t)
    {
        float u = 1 - t;
        return new PointF(
            u * u * u * p0.X + 3 * u * u * t * p1.X + 3 * u * t * t * p2.X + t * t * t * p3.X,
            u * u * u * p0.Y + 3 * u * u * t * p1.Y + 3 * u * t * t * p2.Y + t * t * t * p3.Y);
    }

    static PointF BezTan(PointF p0, PointF p1, PointF p2, PointF p3, float t)
    {
        float u = 1 - t;
        return new PointF(
            3 * u * u * (p1.X - p0.X) + 6 * u * t * (p2.X - p1.X) + 3 * t * t * (p3.X - p2.X),
            3 * u * u * (p1.Y - p0.Y) + 6 * u * t * (p2.Y - p1.Y) + 3 * t * t * (p3.Y - p2.Y));
    }

    // ---------- 1. chronograph ring ----------

    static void DrawRing(Graphics g)
    {
        Base(g);
        float cx = 128, cy = 128, rad = 76, w = 15;
        ArcGradient(g, cx, cy, rad, 30, 300, w, C(56, 224, 255), C(150, 110, 255), C(110, 140, 255));
        double a0 = 30 * Math.PI / 180, a1 = 330 * Math.PI / 180;
        float sx = cx + (float)(rad * Math.Cos(a0)), sy = cy + (float)(rad * Math.Sin(a0));
        float ex = cx + (float)(rad * Math.Cos(a1)), ey = cy + (float)(rad * Math.Sin(a1));
        using (var b = new SolidBrush(CA(90, 160, 180, 220))) g.FillEllipse(b, sx - 4, sy - 4, 8, 8);
        GlowDot(g, ex, ey, 9f, CA(255, 240, 250, 255), C(120, 190, 255));
        using (var b = new SolidBrush(CA(120, 108, 140, 255))) g.FillEllipse(b, cx - 3.5f, cy - 3.5f, 7, 7);
    }

    // ---------- 2. glyph ----------

    static void DrawGlyph(Graphics g)
    {
        Base(g);
        string s = "\u65f6";
        using (var f = new Font("Microsoft YaHei", 118, FontStyle.Bold, GraphicsUnit.Pixel))
        using (var sf = new StringFormat { Alignment = StringAlignment.Center, LineAlignment = StringAlignment.Center })
        {
            using (var glow = new SolidBrush(CA(26, 108, 140, 255)))
            {
                for (int i = 0; i < 8; i++)
                {
                    double ang = i * Math.PI / 4;
                    g.DrawString(s, f, glow, 128 + (float)(Math.Cos(ang) * 3), 128 + (float)(Math.Sin(ang) * 3), sf);
                }
            }
            using (var sh = new SolidBrush(CA(90, 0, 0, 0)))
                g.DrawString(s, f, sh, 128, 132, sf);
            using (var lg = new LinearGradientBrush(new RectangleF(70, 52, 120, 150), CA(255, 255, 255, 255), CA(255, 150, 170, 255), 90f))
                g.DrawString(s, f, lg, 128, 126, sf);
        }
    }

    // ---------- 3. hourglass ----------

    static void DrawHourglass(Graphics g)
    {
        Base(g);
        var body = new GraphicsPath();
        body.AddPolygon(new[] { new PointF(99, 71), new PointF(128, 128), new PointF(157, 71) });
        body.AddPolygon(new[] { new PointF(99, 194), new PointF(128, 128), new PointF(157, 194) });
        using (var b = new SolidBrush(CA(13, 255, 255, 255))) g.FillPath(b, body);

        var sideL = new GraphicsPath();
        sideL.AddBezier(97, 71, 106, 96, 120, 114, 128, 128);
        sideL.AddBezier(128, 128, 120, 142, 106, 160, 97, 194);
        var sideR = new GraphicsPath();
        sideR.AddBezier(159, 71, 150, 96, 136, 114, 128, 128);
        sideR.AddBezier(128, 128, 136, 142, 150, 160, 159, 194);
        using (var pen = new Pen(CA(170, 175, 194, 230), 2.4f))
        {
            pen.LineJoin = LineJoin.Round;
            g.DrawPath(pen, sideL);
            g.DrawPath(pen, sideR);
        }

        var plateR = new RectangleF(88, 62, 80, 9);
        using (var pt = RoundRect(plateR, 4.5f))
        using (var lg = new LinearGradientBrush(plateR, CA(255, 236, 241, 251), CA(255, 158, 178, 214), 90f))
            g.FillPath(lg, pt);
        var plateB = new RectangleF(88, 185, 80, 9);
        using (var pb = RoundRect(plateB, 4.5f))
        using (var lg = new LinearGradientBrush(plateB, CA(255, 236, 241, 251), CA(255, 158, 178, 214), 90f))
            g.FillPath(lg, pb);

        // residual sand (top)
        using (var h1 = RoundRect(new RectangleF(105, 73.5f, 46, 11), 5.5f))
        using (var b = new SolidBrush(CA(24, 80, 220, 255)))
            g.FillPath(b, h1);
        using (var h2 = RoundRect(new RectangleF(107, 74.5f, 42, 8.5f), 4.25f))
        using (var b = new SolidBrush(CA(40, 80, 220, 255)))
            g.FillPath(b, h2);
        using (var core = RoundRect(new RectangleF(109, 76, 38, 5.5f), 2.75f))
        using (var lg = new LinearGradientBrush(new RectangleF(109, 76, 38, 5.5f), CA(255, 178, 240, 255), CA(220, 88, 200, 255), 0f))
            g.FillPath(lg, core);

        // stream + falling dots
        using (var pen = new Pen(CA(38, 79, 224, 255), 5f)) g.DrawLine(pen, 128, 86, 128, 158);
        using (var pen = new Pen(CA(120, 79, 224, 255), 1.5f)) g.DrawLine(pen, 128, 86, 128, 158);
        float[][] dots = {
            new float[]{ 126, 100, 2.2f }, new float[]{ 130, 112, 1.7f }, new float[]{ 127, 124, 2.4f },
            new float[]{ 129.5f, 138, 1.8f }, new float[]{ 126.5f, 150, 2.1f } };
        foreach (var d in dots)
            using (var b = new SolidBrush(CA(210, 198, 244, 255)))
                g.FillEllipse(b, d[0] - d[2], d[1] - d[2], d[2] * 2, d[2] * 2);

        // sand pile (bottom)
        var pile = new GraphicsPath();
        pile.AddBezier(102, 183, 112, 166, 120, 160, 128, 160);
        pile.AddBezier(128, 160, 136, 160, 144, 166, 154, 183);
        pile.CloseFigure();
        using (var b = new SolidBrush(CA(36, 80, 220, 255))) g.FillPath(b, pile);
        using (var b = new SolidBrush(CA(60, 80, 220, 255))) g.FillPath(b, pile);
        using (var lg = new LinearGradientBrush(new RectangleF(102, 160, 52, 23), CA(255, 224, 250, 255), CA(190, 90, 216, 255), 90f))
            g.FillPath(lg, pile);
        using (var b = new SolidBrush(CA(220, 255, 255, 255))) g.FillEllipse(b, 126.5f, 161f, 3f, 3f);
    }

    // ---------- 4. comet ----------

    static void DrawComet(Graphics g)
    {
        Base(g);
        var p0 = new PointF(52, 200);
        var c1 = new PointF(84, 128);
        var c2 = new PointF(140, 84);
        var p1 = new PointF(206, 58);
        int n = 60;
        var top = new PointF[n + 1];
        var bot = new PointF[n + 1];
        for (int i = 0; i <= n; i++)
        {
            float t = i / (float)n;
            var pt = Bez(p0, c1, c2, p1, t);
            var tan = BezTan(p0, c1, c2, p1, t);
            float len = (float)Math.Sqrt(tan.X * tan.X + tan.Y * tan.Y);
            float nx = -tan.Y / len, ny = tan.X / len;
            float w = 15f * (float)Math.Pow(1 - t, 1.35) + 2.4f;
            top[i] = new PointF(pt.X + nx * w / 2, pt.Y + ny * w / 2);
            bot[i] = new PointF(pt.X - nx * w / 2, pt.Y - ny * w / 2);
        }
        var pts = new List<PointF>();
        pts.AddRange(top);
        for (int i = n; i >= 0; i--) pts.Add(bot[i]);
        using (var body = new GraphicsPath())
        {
            body.AddPolygon(pts.ToArray());
            using (var lg = new LinearGradientBrush(p0, p1, CA(0, 56, 224, 255), CA(255, 240, 248, 255)))
            {
                lg.InterpolationColors = new ColorBlend(3)
                {
                    Colors = new[] { CA(0, 56, 224, 255), CA(220, 56, 224, 255), CA(255, 240, 248, 255) },
                    Positions = new[] { 0f, 0.55f, 1f }
                };
                g.FillPath(lg, body);
            }
        }
        var tail = new GraphicsPath();
        tail.AddBezier(74, 212, 106, 146, 152, 112, 198, 90);
        using (var lg2 = new LinearGradientBrush(new PointF(74, 212), new PointF(198, 90), CA(0, 150, 110, 255), CA(160, 150, 110, 255)))
        using (var pen = new Pen(lg2, 2.6f))
        {
            pen.StartCap = LineCap.Round; pen.EndCap = LineCap.Round;
            g.DrawPath(pen, tail);
        }
        GlowDot(g, 198, 90, 4f, CA(230, 235, 245, 255), C(150, 110, 255));
        GlowDot(g, p1.X, p1.Y, 8f, CA(255, 240, 250, 255), C(120, 190, 255));
    }

    // ---------- 5. gold ring ----------

    static void DrawGold(Graphics g)
    {
        Base(g);
        float cx = 128, cy = 128, rad = 76;
        Color[] stops = { C(248, 235, 184), C(200, 155, 70), C(244, 222, 154), C(143, 106, 40), C(248, 235, 184) };
        using (var pen = new Pen(CA(14, 232, 200, 120), 24))
        {
            pen.StartCap = LineCap.Round; pen.EndCap = LineCap.Round;
            g.DrawEllipse(pen, cx - rad, cy - rad, rad * 2, rad * 2);
        }
        using (var pen = new Pen(CA(24, 232, 200, 120), 15))
        {
            pen.StartCap = LineCap.Round; pen.EndCap = LineCap.Round;
            g.DrawEllipse(pen, cx - rad, cy - rad, rad * 2, rad * 2);
        }
        int n = 72;
        for (int i = 0; i < n; i++)
        {
            float t0 = i / (float)n, t1 = (i + 1) / (float)n;
            var col = Wheel(stops, (t0 + t1) / 2f);
            using (var pen = new Pen(col, 7))
            {
                pen.StartCap = LineCap.Round; pen.EndCap = LineCap.Round;
                g.DrawArc(pen, cx - rad, cy - rad, rad * 2, rad * 2, i * (360f / n), 360f / n + 0.8f);
            }
        }
        using (var b = new SolidBrush(CA(50, 240, 214, 140))) g.FillEllipse(b, 116, 40, 24, 24);
        var dm = new[] { new PointF(128, 42), new PointF(137, 51), new PointF(128, 60), new PointF(119, 51) };
        using (var lg = new LinearGradientBrush(new RectangleF(119, 42, 18, 18), CA(255, 255, 247, 210), CA(255, 217, 180, 94), 90f))
            g.FillPolygon(lg, dm);
        using (var b = new SolidBrush(CA(40, 232, 200, 120))) g.FillEllipse(b, 128 - 12, 128 - 12, 24, 24);
        using (var b = new SolidBrush(CA(180, 232, 200, 120))) g.FillEllipse(b, 128 - 4.5f, 128 - 4.5f, 9, 9);
    }

    // ---------- 6. refined eye ----------

    static void DrawEye(Graphics g)
    {
        Base(g);
        var eye = new GraphicsPath();
        eye.AddBezier(54, 128, 92, 84, 164, 84, 202, 128);
        eye.AddBezier(202, 128, 164, 172, 92, 172, 54, 128);
        eye.CloseFigure();
        using (var pen = new Pen(CA(16, 120, 190, 255), 11)) { pen.LineJoin = LineJoin.Round; g.DrawPath(pen, eye); }
        using (var pen = new Pen(CA(26, 120, 190, 255), 7)) { pen.LineJoin = LineJoin.Round; g.DrawPath(pen, eye); }
        using (var lg = new LinearGradientBrush(new RectangleF(54, 84, 148, 88), C(56, 224, 255), C(150, 110, 255), 0f))
        using (var pen = new Pen(lg, 4.2f))
        {
            pen.LineJoin = LineJoin.Round;
            g.DrawPath(pen, eye);
        }
        using (var lg = new LinearGradientBrush(new RectangleF(101, 101, 54, 54), C(56, 224, 255), C(150, 110, 255), 90f))
        using (var pen = new Pen(lg, 3.4f))
            g.DrawEllipse(pen, 128 - 27, 128 - 27, 54, 54);
        GlowDot(g, 128, 128, 7.5f, CA(255, 240, 248, 255), C(140, 180, 255));
        using (var b = new SolidBrush(CA(200, 255, 255, 255))) g.FillEllipse(b, 158, 102, 5, 5);
    }
}
