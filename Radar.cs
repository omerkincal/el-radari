using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Drawing;
using System.Threading;
using System.Windows.Forms;

public static class Radar
{
    static volatile bool paused;
    static readonly object PointerLock = new object();
    static bool pointerDown;
    static long lastPointerUpdate;
    static long lastPointerPacket;
    const string Host = "127.0.0.1:8765";
    const string Origin = "http://" + Host;
    static readonly Dictionary<string, byte> Keys = new Dictionary<string, byte> {
        { "next", 0x27 }, { "prev", 0x25 }, { "play", 0xB3 }, { "louder", 0xAF },
        { "taskView", 0x09 }, { "louder10", 0xAF }, { "quieter", 0xAE }, { "mute", 0xAD }, { "nextTrack", 0xB0 }, { "prevTrack", 0xB1 }
    };
    [DllImport("user32.dll")]
    static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extra);

    [StructLayout(LayoutKind.Sequential)]
    struct KeyboardInput {
        public ushort VirtualKey, Scan;
        public uint Flags, Time;
        public UIntPtr Extra;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct MouseInput {
        public int X, Y;
        public uint Data, Flags, Time;
        public UIntPtr Extra;
    }

    [StructLayout(LayoutKind.Explicit)]
    struct InputData {
        [FieldOffset(0)] public KeyboardInput Keyboard;
        [FieldOffset(0)] public MouseInput Mouse;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct Input {
        public uint Type;
        public InputData Data;
    }

    [DllImport("user32.dll", SetLastError = true)]
    static extern uint SendInput(uint count, Input[] inputs, int size);

    static Input Key(ushort key, uint flags)
    {
        return new Input { Type = 1, Data = new InputData {
            Keyboard = new KeyboardInput { VirtualKey = key, Flags = flags }
        }};
    }

    static Input Mouse(int x, int y, uint flags, uint data = 0)
    {
        return new Input { Type = 0, Data = new InputData {
            Mouse = new MouseInput { X = x, Y = y, Flags = flags, Data = data }
        }};
    }

    static void ReleasePointer()
    {
        lock (PointerLock) {
            if (pointerDown && SendInput(1, new[] { Mouse(0, 0, 4) }, Marshal.SizeOf(typeof(Input))) == 1)
                pointerDown = false;
        }
    }

    static bool UpdatePointer(int x, int y, int button, int wheel)
    {
        lock (PointerLock) {
            bool down = button == 1;
            var inputs = new List<Input>();
            if (wheel != 0) inputs.Add(Mouse(0, 0, 0x0800, unchecked((uint)wheel)));
            else inputs.Add(Mouse(x, y, 0xC001));
            if (pointerDown != down) inputs.Add(Mouse(0, 0, down ? 2u : 4u));
            if (button == 2) {
                inputs.Add(Mouse(0, 0, 8));
                inputs.Add(Mouse(0, 0, 16));
            }
            uint sent = SendInput((uint)inputs.Count, inputs.ToArray(), Marshal.SizeOf(typeof(Input)));
            if (sent != inputs.Count) return false;
            pointerDown = down;
            lastPointerUpdate = Stopwatch.GetTimestamp();
            return true;
        }
    }

    static bool OpenTaskView()
    {
        var inputs = new[] { Key(0x5B, 1), Key(0x09, 0), Key(0x09, 2), Key(0x5B, 3) };
        int size = Marshal.SizeOf(typeof(Input));
        uint sent = SendInput((uint)inputs.Length, inputs, size);
        if (sent == (uint)inputs.Length) return true;
        if (sent > 0) SendInput(2, new[] { Key(0x09, 2), Key(0x5B, 3) }, size);
        return false;
    }

    public static void Run(string folder)
    {
        var secret = new byte[18];
        using (var rng = RandomNumberGenerator.Create()) rng.GetBytes(secret);
        string code = Convert.ToBase64String(secret).Replace('+', '-').Replace('/', '_');
        var server = new TcpListener(IPAddress.Loopback, 8765);
        server.Start();
        var pointerWatchdog = new System.Threading.Timer(_ => {
            lock (PointerLock) {
                if (paused || Stopwatch.GetTimestamp() - lastPointerUpdate > Stopwatch.Frequency / 2)
                    ReleasePointer();
            }
        }, null, 100, 100);
        try {
            if (Environment.GetEnvironmentVariable("EL_RADARI_DESKTOP") == "1") {
                Console.WriteLine("RADAR_READY " + code);
                var parentMonitor = new Thread(() => {
                    Console.In.ReadLine();
                    server.Stop();
                }) { IsBackground = true };
                parentMonitor.Start();
                Serve(server, folder, code);
                return;
            }
            var worker = new Thread(() => Serve(server, folder, code)) { IsBackground = true };
            worker.Start();
            using (var menu = new ContextMenuStrip())
            using (var tray = new NotifyIcon { Icon = SystemIcons.Application, Text = "El Radari" }) {
                var open = menu.Items.Add("Paneli ac");
                open.Click += (sender, args) => OpenPanel(code);
                var toggle = menu.Items.Add("Windows komutlarini duraklat");
                toggle.Click += (sender, args) => {
                    paused = !paused;
                    toggle.Text = paused ? "Windows komutlarini surdur" : "Windows komutlarini duraklat";
                };
                menu.Items.Add("Cikis").Click += (sender, args) => Application.ExitThread();
                tray.ContextMenuStrip = menu;
                tray.DoubleClick += (sender, args) => OpenPanel(code);
                tray.Visible = true;
                Console.WriteLine("El Radari hazir. Tepsideki simgeden kontrol edebilirsin.");
                OpenPanel(code);
                Application.Run();
                tray.Visible = false;
            }
        } finally {
            server.Stop();
            pointerWatchdog.Dispose();
            ReleasePointer();
        }
    }

    static void OpenPanel(string code)
    {
        string url = Origin + "/#code=" + code;
        foreach (var root in new[] { Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86),
                                    Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles) }) {
            if (String.IsNullOrEmpty(root)) continue;
            string edge = Path.Combine(root, @"Microsoft\Edge\Application\msedge.exe");
            if (!File.Exists(edge)) continue;
            try {
                Process.Start(new ProcessStartInfo(edge, "--app=" + url) { UseShellExecute = false });
                return;
            } catch (System.ComponentModel.Win32Exception) {}
        }
        Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
    }

    static void Serve(TcpListener server, string folder, string code)
    {
        var clock = Stopwatch.StartNew();
        long last = -1000;
        try {
            while (true) {
                using (var client = server.AcceptTcpClient()) {
                    client.ReceiveTimeout = 1500;
                    client.SendTimeout = 1500;
                    try { Handle(client.GetStream(), folder, code, clock, ref last); }
                    catch (IOException) {}
                }
            }
        } catch (SocketException) {} catch (InvalidOperationException) {}
    }

    static void Handle(NetworkStream stream, string folder, string code, Stopwatch clock, ref long last)
    {
        var header = new StringBuilder();
        while (header.Length < 16384) {
            int value = stream.ReadByte();
            if (value < 0) return;
            header.Append((char)value);
            int end = header.Length - 1;
            if (end >= 3 && header[end] == '\n' && header[end-1] == '\r'
                && header[end-2] == '\n' && header[end-3] == '\r') break;
        }
        if (header.Length >= 16384) return;
        var lines = header.ToString().Split(new[] { "\r\n" }, StringSplitOptions.None);
        var request = lines[0].Split(' ');
        if (request.Length != 3) return;
        var headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (string line in lines) {
            int colon = line.IndexOf(':');
            if (colon > 0) headers[line.Substring(0, colon)] = line.Substring(colon + 1).Trim();
        }
        string host, origin, suppliedCode;
        if (!headers.TryGetValue("Host", out host) || host != Host) {
            Reply(stream, "403 Forbidden"); return;
        }
        string path = request[1];
        if (request[0] == "GET") {
            string file = path == "/" ? "index.html" : path == "/app.mjs" ? "app.mjs" :
                          path == "/commands.mjs" ? "commands.mjs" : null;
            if (file == null) { Reply(stream, "404 Not Found"); return; }
            Reply(stream, "200 OK", File.ReadAllBytes(Path.Combine(folder, file)),
                  file == "index.html" ? "text/html" : "text/javascript");
            return;
        }
        if (request[0] != "POST" || !headers.TryGetValue("Origin", out origin) || origin != Origin ||
            !headers.TryGetValue("X-Radar-Code", out suppliedCode) || suppliedCode != code) {
            Reply(stream, "403 Forbidden"); return;
        }
        if (path == "/connect") { Reply(stream, "204 No Content"); return; }
        if (path.StartsWith("/pointer/", StringComparison.Ordinal)) {
            if (paused) { Reply(stream, "423 Locked"); return; }
            string[] values = path.Substring(9).Split('/');
            int x, y, down, wheel;
            if (values.Length != 4 || !Int32.TryParse(values[0], out x) ||
                !Int32.TryParse(values[1], out y) || !Int32.TryParse(values[2], out down) ||
                !Int32.TryParse(values[3], out wheel) || x < 0 || x > 65535 ||
                y < 0 || y > 65535 || down < 0 || down > 2 || (wheel != -120 && wheel != 0 && wheel != 120)) {
                Reply(stream, "400 Bad Request"); return;
            }
            long nowPointer = clock.ElapsedMilliseconds;
            if (nowPointer - lastPointerPacket < 25) { Reply(stream, "429 Too Many Requests"); return; }
            lastPointerPacket = nowPointer;
            Reply(stream, UpdatePointer(x, y, down, wheel) ? "204 No Content" : "503 Service Unavailable");
            return;
        }
        if (path == "/command/keyboard") {
            if (paused) { Reply(stream, "423 Locked"); return; }
            try {
                Process.Start(new ProcessStartInfo(Path.Combine(Environment.SystemDirectory, "osk.exe")) { UseShellExecute = true });
                Reply(stream, "204 No Content");
            } catch (System.ComponentModel.Win32Exception) { Reply(stream, "503 Service Unavailable"); }
            return;
        }
        byte key;
        if (!path.StartsWith("/command/", StringComparison.Ordinal) ||
            !Keys.TryGetValue(path.Substring(9), out key)) {
            Reply(stream, "404 Not Found"); return;
        }
        if (paused) { Reply(stream, "423 Locked"); return; }
        long now = clock.ElapsedMilliseconds;
        if (now - last < 650) { Reply(stream, "429 Too Many Requests"); return; }
        if (path == "/command/taskView") {
            if (!OpenTaskView()) { Reply(stream, "503 Service Unavailable"); return; }
            last = now;
            Reply(stream, "204 No Content");
            return;
        }
        int steps = path == "/command/louder10" ? 5 : 1;
        for (int step = 0; step < steps; step++) {
            keybd_event(key, 0, 1, UIntPtr.Zero);
            keybd_event(key, 0, 3, UIntPtr.Zero);
        }
        last = now;
        Reply(stream, "204 No Content");
    }

    static void Reply(NetworkStream stream, string status, byte[] body = null, string type = "text/plain")
    {
        var header = Encoding.ASCII.GetBytes("HTTP/1.1 " + status +
            "\r\nConnection: close\r\nCache-Control: no-store\r\nContent-Security-Policy: frame-ancestors 'none'" +
            "\r\nContent-Type: " + type + "; charset=utf-8\r\nContent-Length: " +
            (body == null ? 0 : body.Length) + "\r\n\r\n");
        stream.Write(header, 0, header.Length);
        if (body != null) stream.Write(body, 0, body.Length);
    }
}
