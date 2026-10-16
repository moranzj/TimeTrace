// capture.cs - 前台窗口 / 空闲时间 / 截图采集器（编译型版本）
// 构建：csc.exe /nologo /target:winexe /out:capture.exe capture.cs /r:System.dll /r:System.Core.dll /r:System.Drawing.dll /r:System.Windows.Forms.dll
// 运行：capture.exe --root <目录> --tick 10 --shot 1 --quality 45 --maxwidth 1600 --idleskip 120
using System;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Windows.Forms;

static class Capture
{
    struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }

    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
    [DllImport("user32.dll")] static extern bool GetLastInputInfo(ref LASTINPUTINFO info);
    [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
    [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern bool QueryFullProcessImageName(IntPtr hProcess, uint flags, StringBuilder exeName, ref uint size);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
    const uint PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;

    static string root = ".";
    static int tickSeconds = 10;
    static bool shotEnabled = true;
    static int shotQuality = 45;
    static int shotMaxWidth = 1600;
    static int idleSkip = 120;
    static string lastHash = "";
    static readonly MD5 md5 = MD5.Create();
    static readonly UTF8Encoding utf8NoBom = new UTF8Encoding(false);

    static void Main(string[] args)
    {
        for (int i = 0; i < args.Length - 1; i++)
        {
            switch (args[i])
            {
                case "--root": root = args[++i]; break;
                case "--tick": int.TryParse(args[++i], out tickSeconds); break;
                case "--shot": shotEnabled = args[++i] != "0"; break;
                case "--quality": int.TryParse(args[++i], out shotQuality); break;
                case "--maxwidth": int.TryParse(args[++i], out shotMaxWidth); break;
                case "--idleskip": int.TryParse(args[++i], out idleSkip); break;
            }
        }
        if (tickSeconds < 1) tickSeconds = 10;
        if (shotQuality < 10) shotQuality = 45;
        if (shotMaxWidth < 320) shotMaxWidth = 1600;
        if (idleSkip < 5) idleSkip = 120;

        try { SetProcessDPIAware(); } catch { }

        string runDir = Path.Combine(root, "data", "run");
        try
        {
            Directory.CreateDirectory(runDir);
            File.WriteAllText(Path.Combine(runDir, "capture.pid"), Process.GetCurrentProcess().Id.ToString());
        }
        catch { }

        while (true)
        {
            DateTime start = DateTime.Now;
            try { DoTick(); } catch { }
            int elapsed = (int)(DateTime.Now - start).TotalMilliseconds;
            int sleep = tickSeconds * 1000 - elapsed;
            if (sleep < 200) sleep = 200;
            Thread.Sleep(sleep);
        }
    }

    static void DoTick()
    {
        DateTime now = DateTime.Now;
        string app = "";
        string title = "";
        int idle = 0;
        string shot = "";
        string error = "";
        try
        {
            idle = GetIdleSeconds();

            IntPtr hwnd = GetForegroundWindow();
            if (hwnd != IntPtr.Zero)
            {
                var sb = new StringBuilder(512);
                GetWindowText(hwnd, sb, 512);
                title = Clean(sb.ToString(), 160);

                uint wpid;
                GetWindowThreadProcessId(hwnd, out wpid);
                if (wpid != 0) app = GetAppName(wpid);
            }

            bool isLocked = app == "LogonUI" || app == "LockApp";
            if (shotEnabled && !isLocked && idle < idleSkip)
            {
                shot = TakeShot(now);
            }
        }
        catch (Exception ex)
        {
            error = Clean(ex.Message, 180);
        }

        var line = new StringBuilder(512);
        line.Append("{\"ts\":\"").Append(now.ToString("yyyy-MM-ddTHH:mm:ss")).Append('"');
        line.Append(",\"app\":\"").Append(JsonEscape(app)).Append('"');
        line.Append(",\"title\":\"").Append(JsonEscape(title)).Append('"');
        line.Append(",\"idle\":").Append(idle);
        line.Append(",\"shot\":\"").Append(JsonEscape(shot)).Append('"');
        if (error.Length > 0) line.Append(",\"error\":\"").Append(JsonEscape(error)).Append('"');
        line.Append('}');

        try
        {
            string day = now.ToString("yyyy-MM-dd");
            string logDir = Path.Combine(root, "data", "logs", "raw");
            Directory.CreateDirectory(logDir);
            File.AppendAllText(Path.Combine(logDir, day + ".jsonl"), line.ToString() + "\n", utf8NoBom);
        }
        catch { }
    }

    static string TakeShot(DateTime now)
    {
        Rectangle b = SystemInformation.VirtualScreen;
        if (b.Width <= 0 || b.Height <= 0) return "";

        using (var full = new Bitmap(b.Width, b.Height))
        {
            using (var g = Graphics.FromImage(full))
            {
                g.CopyFromScreen(b.Left, b.Top, 0, 0, full.Size);
            }

            // 缩略图哈希去重：画面没变化就不落盘
            string hash;
            int tw = 128;
            int th = Math.Max(1, (int)Math.Round(128.0 * b.Height / b.Width));
            using (var thumb = new Bitmap(tw, th))
            {
                using (var tg = Graphics.FromImage(thumb))
                {
                    tg.InterpolationMode = InterpolationMode.Low;
                    tg.DrawImage(full, 0, 0, tw, th);
                }
                using (var ms = new MemoryStream())
                {
                    thumb.Save(ms, ImageFormat.Jpeg);
                    hash = BitConverter.ToString(md5.ComputeHash(ms.ToArray()));
                }
            }
            if (hash == lastHash) return "";
            lastHash = hash;

            Bitmap save = full;
            bool scaled = false;
            if (b.Width > shotMaxWidth)
            {
                int nw = shotMaxWidth;
                int nh = Math.Max(1, (int)Math.Round(b.Height * (double)nw / b.Width));
                var scaledBmp = new Bitmap(nw, nh);
                using (var sg = Graphics.FromImage(scaledBmp))
                {
                    sg.InterpolationMode = InterpolationMode.HighQualityBicubic;
                    sg.DrawImage(full, 0, 0, nw, nh);
                }
                save = scaledBmp;
                scaled = true;
            }

            try
            {
                string day = now.ToString("yyyy-MM-dd");
                string dir = Path.Combine(root, "shots", day);
                Directory.CreateDirectory(dir);
                string name = now.ToString("HHmmss") + ".jpg";
                string dst = Path.Combine(dir, name);
                ImageCodecInfo codec = GetJpegCodec();
                if (codec != null)
                {
                    using (var ep = new EncoderParameters(1))
                    {
                        ep.Param[0] = new EncoderParameter(System.Drawing.Imaging.Encoder.Quality, (long)shotQuality);
                        save.Save(dst, codec, ep);
                    }
                }
                else
                {
                    save.Save(dst, ImageFormat.Jpeg);
                }
                return "shots/" + day + "/" + name;
            }
            finally
            {
                if (scaled) save.Dispose();
            }
        }
    }

    static ImageCodecInfo GetJpegCodec()
    {
        foreach (ImageCodecInfo c in ImageCodecInfo.GetImageEncoders())
        {
            if (c.MimeType == "image/jpeg") return c;
        }
        return null;
    }

    static int GetIdleSeconds()
    {
        var li = new LASTINPUTINFO();
        li.cbSize = (uint)Marshal.SizeOf(typeof(LASTINPUTINFO));
        if (!GetLastInputInfo(ref li)) return 0;
        uint tick = unchecked((uint)Environment.TickCount);
        uint ms = tick - li.dwTime;
        return (int)Math.Round(ms / 1000.0);
    }

    // 取进程名：优先 QueryFullProcessImageName（对提权/受保护进程也可用），兜底托管 API
    static string GetAppName(uint pid)
    {
        try
        {
            IntPtr h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
            if (h != IntPtr.Zero)
            {
                try
                {
                    var sb = new StringBuilder(1024);
                    uint size = 1024;
                    if (QueryFullProcessImageName(h, 0, sb, ref size))
                    {
                        string name = Path.GetFileNameWithoutExtension(sb.ToString());
                        if (!string.IsNullOrEmpty(name)) return Clean(name, 80);
                    }
                }
                finally { CloseHandle(h); }
            }
        }
        catch { }
        try { return Clean(Process.GetProcessById((int)pid).ProcessName, 80); }
        catch { return ""; }
    }

    static string Clean(string s, int max)
    {
        if (string.IsNullOrEmpty(s)) return "";
        var sb = new StringBuilder(s.Length);
        foreach (char c in s) sb.Append(char.IsControl(c) ? ' ' : c);
        string r = sb.ToString().Trim();
        return r.Length > max ? r.Substring(0, max) : r;
    }

    static string JsonEscape(string s)
    {
        if (string.IsNullOrEmpty(s)) return "";
        var sb = new StringBuilder(s.Length + 8);
        foreach (char c in s)
        {
            switch (c)
            {
                case '"': sb.Append("\\\""); break;
                case '\\': sb.Append("\\\\"); break;
                case '\n': sb.Append("\\n"); break;
                case '\r': sb.Append("\\r"); break;
                case '\t': sb.Append("\\t"); break;
                default:
                    if (c < 0x20) sb.Append("\\u").Append(((int)c).ToString("x4"));
                    else sb.Append(c);
                    break;
            }
        }
        return sb.ToString();
    }
}
