using System;
using System.Runtime.InteropServices;

namespace Whistle.Exhibition {
    [ComImport, Guid("c37ea93a-e7aa-450d-b16f-9746cb0407f3"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface ICompositionDevice {
        void Commit();
        void WaitForCommitCompletion();
        void GetFrameStatistics(IntPtr statistics);
        void CreateTargetForHwnd(IntPtr hwnd, [MarshalAs(UnmanagedType.Bool)] bool topmost, out ICompositionTarget target);
        void CreateVisual(out ICompositionVisual visual);
    }

    [ComImport, Guid("eacdd04c-117e-4e17-88f4-d1b12b0e3d89"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface ICompositionTarget { void SetRoot(ICompositionVisual root); }

    [ComImport, Guid("4d93059d-097b-4651-9a60-f0f25116e2f3"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface ICompositionVisual {}

    sealed class Composition : IDisposable {
        [DllImport("dcomp.dll", PreserveSig = false)]
        static extern void DCompositionCreateDevice(IntPtr renderingDevice, ref Guid iid, out ICompositionDevice device);
        readonly ICompositionDevice device;
        readonly ICompositionTarget target;
        public readonly ICompositionVisual Root;

        public Composition(IntPtr window) {
            var iid = typeof(ICompositionDevice).GUID;
            DCompositionCreateDevice(IntPtr.Zero, ref iid, out device);
            device.CreateTargetForHwnd(window, true, out target);
            device.CreateVisual(out Root);
            target.SetRoot(Root);
        }
        public void Commit() { device.Commit(); }
        public void Dispose() {
            target.SetRoot(null);
            device.Commit();
            Marshal.ReleaseComObject(Root);
            Marshal.ReleaseComObject(target);
            Marshal.ReleaseComObject(device);
        }
    }
}
