using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;

public static class Radar
{
    const string Host = "127.0.0.1:8765";
    const string Origin = "http://" + Host;
    static readonly Dictionary<string, byte> Keys = new Dictionary<string, byte> {
        { "next", 0x27 }, { "prev", 0x25 }, { "play", 0xB3 }, { "louder", 0xAF },
        { "quieter", 0xAE }, { "mute", 0xAD }, { "nextTrack", 0xB0 }, { "prevTrack", 0xB1 }
    };
    [DllImport("user32.dll")]
    static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extra);

    public static void Run(string folder)
    {
        var secret = new byte[18];
        using (var rng = RandomNumberGenerator.Create()) rng.GetBytes(secret);
        string code = Convert.ToBase64String(secret).Replace('+', '-').Replace('/', '_');
        var server = new TcpListener(IPAddress.Loopback, 8765);
        var clock = Stopwatch.StartNew();
        long last = -1000;
        server.Start();
        try {
            Console.WriteLine("El Radari: " + Origin + "\nDurdurmak icin bu pencereyi kapat.");
            Console.WriteLine("Baglanti kodu: " + code);
            Process.Start(new ProcessStartInfo(Origin + "/#code=" + code) { UseShellExecute = true });
            while (true) {
                using (var client = server.AcceptTcpClient()) {
                    client.ReceiveTimeout = 1500;
                    client.SendTimeout = 1500;
                    try { Handle(client.GetStream(), folder, code, clock, ref last); }
                    catch (IOException) {}
                }
            }
        } finally { server.Stop(); }
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
        byte key;
        if (!path.StartsWith("/command/", StringComparison.Ordinal) ||
            !Keys.TryGetValue(path.Substring(9), out key)) {
            Reply(stream, "404 Not Found"); return;
        }
        long now = clock.ElapsedMilliseconds;
        if (now - last < 650) { Reply(stream, "429 Too Many Requests"); return; }
        keybd_event(key, 0, 1, UIntPtr.Zero);
        keybd_event(key, 0, 3, UIntPtr.Zero);
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
