using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;

namespace Whistle.Exhibition {
    // RAWINPUTHEADER is 24 bytes in the x64 exhibition build.
    [StructLayout(LayoutKind.Sequential)]
    struct RawHeader { public uint Type, Size; public IntPtr Device, Param; }
    [StructLayout(LayoutKind.Explicit, Size = 24)]
    struct MousePacket {
        [FieldOffset(0)] public ushort Flags;
        [FieldOffset(4)] public ushort Buttons;
        [FieldOffset(6)] public short Wheel;
        [FieldOffset(12)] public int X;
        [FieldOffset(16)] public int Y;
    }
    [StructLayout(LayoutKind.Sequential)]
    struct RawPacket { public RawHeader Header; public MousePacket Mouse; }
    [StructLayout(LayoutKind.Sequential)]
    struct InputDevice { public ushort Page, Usage; public uint Flags; public IntPtr Window; }
    [StructLayout(LayoutKind.Sequential)]
    struct ListedDevice { public IntPtr Handle; public uint Type; }

    sealed class RawMice {
        [DllImport("user32.dll", SetLastError = true)]
        static extern bool RegisterRawInputDevices(ref InputDevice device, uint count, uint size);
        [DllImport("user32.dll", SetLastError = true)]
        static extern uint GetRawInputData(IntPtr handle, uint command, out RawPacket packet, ref uint size, uint headerSize);
        [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        static extern uint GetRawInputDeviceInfo(IntPtr device, uint command, StringBuilder name, ref uint length);
        [DllImport("user32.dll")]
        static extern uint GetRawInputDeviceList([Out] ListedDevice[] list, ref uint count, uint entrySize);
        readonly Dictionary<IntPtr, string> paths = new Dictionary<IntPtr, string>();
        readonly uint headerSize = (uint)Marshal.SizeOf(typeof(RawHeader));
        public RawMice(IntPtr window) {
            // INPUTSINK + DEVNOTIFY. Composition seats only forward explicitly routed input.
            var device = new InputDevice { Page = 1, Usage = 2, Flags = 0x2100, Window = window };
            if (!RegisterRawInputDevices(ref device, 1, (uint)Marshal.SizeOf(typeof(InputDevice))))
                throw new Win32Exception(Marshal.GetLastWin32Error());
        }
        public string Remove(IntPtr handle) {
            string path;
            paths.TryGetValue(handle, out path);
            paths.Remove(handle);
            return path;
        }
        string Name(IntPtr handle) {
            string path;
            if (paths.TryGetValue(handle, out path)) return path;
            uint length = 0;
            if (GetRawInputDeviceInfo(handle, 0x20000007, null, ref length) == uint.MaxValue || length == 0) return null;
            var name = new StringBuilder((int)length + 1);
            if (GetRawInputDeviceInfo(handle, 0x20000007, name, ref length) == uint.MaxValue || name.Length == 0) return null;
            return paths[handle] = name.ToString();
        }
        public HashSet<string> Connected() {
            var connected = new HashSet<string>();
            uint count = 0, size = (uint)Marshal.SizeOf(typeof(ListedDevice));
            if (GetRawInputDeviceList(null, ref count, size) != 0) return connected;
            var list = new ListedDevice[count];
            uint found = GetRawInputDeviceList(list, ref count, size);
            if (found != uint.MaxValue)
                for (int i = 0; i < found; ++i) if (list[i].Type == 0) connected.Add(Name(list[i].Handle));
            return connected;
        }
        public void Read(IntPtr input, Action<string, MousePacket> receive) {
            uint size = (uint)Marshal.SizeOf(typeof(RawPacket));
            RawPacket packet;
            if (GetRawInputData(input, 0x10000003, out packet, ref size, headerSize) != size ||
                packet.Header.Type != 0 || packet.Header.Device == IntPtr.Zero) return;
            var path = Name(packet.Header.Device);
            if (path != null) receive(path, packet.Mouse);
        }
    }
}
