using System;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Security.Cryptography;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Markup;
using System.Windows.Media;
using System.Windows.Media.Animation;
using System.Windows.Media.Effects;
using System.Windows.Media.Imaging;
using System.Windows.Shapes;
using Microsoft.Win32;
using Path = System.IO.Path;

namespace YuyuPlanner.Setup
{
    internal static class Program
    {
        internal const string FolderName = "Little Fish Planner";
        internal const string ProductName = "鱼鱼日程";
        internal const string ExecutableName = ProductName + ".exe";
        private static Mutex instance;

        [STAThread]
        private static void Main(string[] args)
        {
            bool first;
            instance = new Mutex(true, @"Local\YuyuPlanner.Setup", out first);
            if (!first) { MessageBox.Show("安装窗口已经打开。", ProductName); return; }
            try { new Application().Run(new LiquidInstaller(BuildInfo.Preview || args.Contains("--preview"))); }
            catch (Exception error) { MessageBox.Show("无法打开安装程序：" + error.Message, ProductName); }
            finally { instance.ReleaseMutex(); instance.Dispose(); }
        }

        internal static Stream Resource(string name)
        {
            var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream(name);
            if (stream == null) throw new InvalidDataException("安装包缺少资源：" + name);
            return stream;
        }

        internal static string Destination(string input)
        {
            string value = Environment.ExpandEnvironmentVariables(input.Trim()).Replace('/', '\\');
            if (value.Length < 3 || !Char.IsLetter(value[0]) || value[1] != ':' || value[2] != '\\'
                || value.IndexOfAny(new[] { '"', '<', '>', '|', '*', '?', '\r', '\n', '\0' }) >= 0)
                throw new ArgumentException("请选择本机磁盘中的完整路径，例如 D:\\应用。");
            foreach (string segment in value.Substring(3).Split('\\'))
                if (segment.EndsWith(" ") || segment.EndsWith("."))
                    throw new ArgumentException("文件夹名称不能以空格或句点结尾。");
            string full = System.IO.Path.GetFullPath(value).TrimEnd('\\');
            if (!String.Equals(System.IO.Path.GetFileName(full), FolderName, StringComparison.OrdinalIgnoreCase))
                full = System.IO.Path.Combine(full + (full.Length == 2 ? "\\" : ""), FolderName);
            if (full.Length > 180) throw new ArgumentException("路径太长，请选择层级更少的文件夹。");
            return full;
        }
    }

    internal sealed class LiquidInstaller : Window
    {
        private const double Scale = .7, PanelWidth = 1080, PanelHeight = 850;
        private readonly Canvas stage;
        private readonly Grid outer;
        private readonly Grid panel;
        private readonly TextBox location;
        private readonly Button install, browse, cancel, windowClose;
        private readonly StackPanel form;
        private readonly Grid directory;
        private readonly Border actionGap;
        private readonly TextBlock installText, cancelText;
        private readonly TextBlock status;
        private readonly ProgressBar progress;
        private readonly RectangleGeometry panelClip;
        private readonly ScaleTransform openingScale = new ScaleTransform(1, 1);
        private readonly TranslateTransform openingOffset = new TranslateTransform();
        private readonly bool preview;
        private bool closing, busy, completed;
        private string installedPath;
        private static readonly DependencyProperty SurfaceHeightProperty = DependencyProperty.Register(
            "SurfaceHeight", typeof(double), typeof(LiquidInstaller), new PropertyMetadata(PanelHeight, delegate(DependencyObject owner, DependencyPropertyChangedEventArgs e) {
                var window = (LiquidInstaller)owner; var height = (double)e.NewValue;
                window.outer.Height = window.panel.Height = height;
                window.panelClip.Rect = new Rect(0, 0, PanelWidth, height);
                window.stage.Height = height + 120;
                window.Height = (height + 120) * Scale;
            }));

        internal LiquidInstaller(bool previewOnly)
        {
            preview = previewOnly;
            Title = preview ? "鱼鱼日程 · 安装界面预览" : "鱼鱼日程 · 安装程序";
            Width = 1200 * Scale; Height = 970 * Scale;
            WindowStyle = WindowStyle.None; ResizeMode = ResizeMode.NoResize;
            AllowsTransparency = true; Background = Brushes.Transparent;
            WindowStartupLocation = WindowStartupLocation.CenterScreen;
            FontFamily = new FontFamily("Segoe UI Variable Text, Segoe UI, Microsoft YaHei UI");
            Foreground = Paint.Solid("#263543");
            TextOptions.SetTextFormattingMode(this, TextFormattingMode.Ideal);
            TextOptions.SetTextRenderingMode(this, TextRenderingMode.Grayscale);
            Icon = ResourceImage("AppIcon.png");

            stage = new Canvas { Width = 1200, Height = 970 };
            var rootMotion = new TransformGroup(); rootMotion.Children.Add(openingScale); rootMotion.Children.Add(openingOffset);
            stage.RenderTransform = rootMotion; stage.RenderTransformOrigin = new Point(.5, .5);
            Content = new Viewbox { Stretch = Stretch.Uniform, Child = stage };
            outer = new Grid { Width = PanelWidth, Height = PanelHeight };
            Canvas.SetLeft(outer, 60); Canvas.SetTop(outer, 40); stage.Children.Add(outer);
            outer.Children.Add(Paint.FrameShadows(1080, 850, 40,
                new Shade(0, 34, 80, "#576A68", .12), new Shade(0, 8, 28, "#596F66", .05)));
            panel = new Grid { Width = PanelWidth, Height = PanelHeight, Background = Brushes.White };
            panelClip = new RectangleGeometry(new Rect(0, 0, PanelWidth, PanelHeight), 40, 40);
            panel.Clip = panelClip; outer.Children.Add(panel);
            panel.Children.Add(new Image { Source = Paint.PanelBackdrop(), Stretch = Stretch.Fill, IsHitTestVisible = false });

            var pointerBrush = new RadialGradientBrush();
            pointerBrush.MappingMode = BrushMappingMode.Absolute;
            pointerBrush.Center = pointerBrush.GradientOrigin = new Point(345, 25);
            pointerBrush.RadiusX = pointerBrush.RadiusY = 430;
            pointerBrush.GradientStops.Add(new GradientStop(Paint.ColorOf("#33FFFFFF"), 0));
            pointerBrush.GradientStops.Add(new GradientStop(Paint.ColorOf("#16FFFFFF"), .38));
            pointerBrush.GradientStops.Add(new GradientStop(Paint.ColorOf("#00FFFFFF"), .68));
            var pointerLight = new Border { Background = pointerBrush, Opacity = 0, IsHitTestVisible = false };
            panel.Children.Add(pointerLight);
            panel.MouseMove += delegate(object sender, MouseEventArgs e) { pointerBrush.Center = pointerBrush.GradientOrigin = e.GetPosition(panel); };
            panel.MouseEnter += delegate { Animate(pointerLight, OpacityProperty, .9, 300); };
            panel.MouseLeave += delegate { Animate(pointerLight, OpacityProperty, 0, 400); };

            var layout = new Canvas(); panel.Children.Add(layout);
            var dragArea = new Border { Width = 1080, Height = 110, Background = Brushes.Transparent };
            dragArea.MouseLeftButtonDown += delegate { if (Mouse.LeftButton == MouseButtonState.Pressed) DragMove(); };
            layout.Children.Add(dragArea);
            var minimize = WindowButton(false); Place(layout, minimize, 926, 32);
            windowClose = WindowButton(true); Place(layout, windowClose, 992, 32);
            minimize.Click += delegate { WindowState = WindowState.Minimized; };
            windowClose.Click += delegate { Close(); };

            var icon = Paint.Plate(164, 164, 39, "icon");
            icon.Children.Add(new Image { Source = ResourceImage("CalendarMark.png"), Width = 132, Height = 132,
                HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center });
            Place(layout, icon, 458, 148);
            var title = Label("鱼鱼日程", 38, "#22313D", FontWeights.Medium); title.Width = 1080; title.Height = 50;
            Place(layout, title, 0, 350);
            var subtitle = Label("安装程序", 24, "#9BA9B2", FontWeights.Normal); subtitle.Width = 1080; subtitle.Height = 34;
            Place(layout, subtitle, 0, 408);

            form = new StackPanel { Width = 850 }; Place(layout, form, 115, 479);
            directory = new Grid { Height = 128 };
            directory.RowDefinitions.Add(new RowDefinition { Height = new GridLength(58) });
            directory.RowDefinitions.Add(new RowDefinition { Height = new GridLength(70) });
            var caption = Label("安装目录", 25, "#2B3743", FontWeights.Medium);
            caption.TextAlignment = TextAlignment.Left; caption.Margin = new Thickness(4, 0, 0, 20);
            directory.Children.Add(caption);
            var row = new Grid(); row.ColumnDefinitions.Add(new ColumnDefinition());
            row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(22) });
            row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(146) });
            Grid.SetRow(row, 1); directory.Children.Add(row);
            var pathPlate = Paint.Plate(682, 70, 22, "path"); row.Children.Add(pathPlate);
            location = new TextBox { Text = InitialPath(), FontSize = 27, FontWeight = FontWeights.Normal,
                Foreground = Paint.Solid("#707D88"), Background = Brushes.Transparent, BorderThickness = new Thickness(0),
                Padding = new Thickness(28, 0, 28, 0), VerticalContentAlignment = VerticalAlignment.Center,
                HorizontalScrollBarVisibility = ScrollBarVisibility.Hidden, FocusVisualStyle = null };
            var focusRing = new Border { BorderBrush = Paint.Solid("#559EF7DD"), BorderThickness = new Thickness(2),
                CornerRadius = new CornerRadius(22), Opacity = 0, IsHitTestVisible = false };
            pathPlate.Children.Add(focusRing); pathPlate.Children.Add(location);
            location.GotKeyboardFocus += delegate { Animate(focusRing, OpacityProperty, 1, 180); };
            location.LostKeyboardFocus += delegate { Animate(focusRing, OpacityProperty, 0, 180); };
            TextBlock browseText; browse = GlassButton("浏览", 146, 70, 22, 24, "browse", out browseText);
            Grid.SetColumn(browse, 2); row.Children.Add(browse); browse.Click += delegate { Browse(); };
            form.Children.Add(directory);
            actionGap = new Border { Height = 48 }; form.Children.Add(actionGap);
            var actions = new Grid { Width = 536, Height = 80, HorizontalAlignment = HorizontalAlignment.Center };
            actions.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(256) });
            actions.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(24) });
            actions.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(256) });
            install = GlassButton("安装", 256, 80, 40, 25, "primary", out installText);
            cancel = GlassButton("取消", 256, 80, 40, 25, "secondary", out cancelText);
            Grid.SetColumn(cancel, 2);
            actions.Children.Add(install); actions.Children.Add(cancel); form.Children.Add(actions);
            progress = new ProgressBar { Width = 536, Height = 4, Margin = new Thickness(0, 32, 0, 0),
                Minimum = 0, Maximum = 100, Visibility = Visibility.Collapsed, BorderThickness = new Thickness(0),
                Foreground = Paint.Solid("#A86FEFD2"), Background = Paint.Solid("#22FFFFFF") };
            status = Label(String.Empty, 18, "#7A627C86", FontWeights.Normal);
            status.Height = 42; status.Margin = new Thickness(0, 14, 0, 0);
            form.Children.Add(progress); form.Children.Add(status);
            install.Click += async delegate {
                if (completed) { if (preview) Close(); else Launch(); return; }
                if (preview) await SimulateInstall(); else await Install();
            };
            cancel.Click += delegate { Close(); };

            panel.Children.Add(Paint.StretchFrame(Paint.Rim(1080, 850, 40, 1.8, 205, false), 40, 0));
            panel.Children.Add(new Border { CornerRadius = new CornerRadius(39), Margin = new Thickness(1),
                BorderThickness = new Thickness(1), BorderBrush = Paint.Linear("#B3FFFFFF", "#1FFFFFFF", "#85FFFFFF"), IsHitTestVisible = false });
            Loaded += delegate {
                Focus();
                if (!SystemParameters.ClientAreaAnimation) return;
                Animate(openingScale, ScaleTransform.ScaleXProperty, .986, 1, 600);
                Animate(openingScale, ScaleTransform.ScaleYProperty, .986, 1, 600);
                Animate(openingOffset, TranslateTransform.YProperty, 16, 0, 600);
                Animate(stage, OpacityProperty, 0, 1, 450);
            };
            Closing += delegate(object sender, System.ComponentModel.CancelEventArgs e) {
                if (busy) { e.Cancel = true; return; }
                if (closing || !SystemParameters.ClientAreaAnimation) return;
                e.Cancel = true; closing = true; IsHitTestVisible = false;
                Animate(openingScale, ScaleTransform.ScaleXProperty, .973, 250);
                Animate(openingScale, ScaleTransform.ScaleYProperty, .973, 250);
                var exit = new DoubleAnimation(13, TimeSpan.FromMilliseconds(250)) { EasingFunction = new CubicEase { EasingMode = EasingMode.EaseIn } };
                exit.Completed += delegate { Close(); };
                openingOffset.BeginAnimation(TranslateTransform.YProperty, exit);
                Animate(stage, OpacityProperty, 0, 250);
            };
            PreviewKeyDown += delegate(object sender, KeyEventArgs e) { if (e.Key == Key.Escape) { e.Handled = true; Close(); } };
        }

        private static void Place(Canvas canvas, FrameworkElement child, double x, double y)
        { Canvas.SetLeft(child, x); Canvas.SetTop(child, y); canvas.Children.Add(child); }

        private static TextBlock Label(string text, double size, string color, FontWeight weight)
        { return new TextBlock { Text = text, FontSize = size, Foreground = Paint.Solid(color), FontWeight = weight, TextAlignment = TextAlignment.Center, VerticalAlignment = VerticalAlignment.Center }; }

        private static BitmapImage ResourceImage(string name)
        {
            using (var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream(name)) {
                var image = new BitmapImage(); image.BeginInit(); image.CacheOption = BitmapCacheOption.OnLoad;
                image.StreamSource = stream; image.EndInit(); image.Freeze(); return image;
            }
        }

        private static Button PlainButton(object content)
        {
            var template = (ControlTemplate)XamlReader.Parse("<ControlTemplate xmlns='http://schemas.microsoft.com/winfx/2006/xaml/presentation' TargetType='Button'><ContentPresenter HorizontalAlignment='Stretch' VerticalAlignment='Stretch'/></ControlTemplate>");
            return new Button { Content = content, Template = template, Background = Brushes.Transparent,
                BorderThickness = new Thickness(0), Padding = new Thickness(0), FocusVisualStyle = null, Cursor = Cursors.Hand };
        }

        private static Button WindowButton(bool close)
        {
            var plate = new Border { Width = 42, Height = 42, CornerRadius = new CornerRadius(21), Background = Brushes.Transparent };
            plate.Child = new System.Windows.Shapes.Path { Data = Geometry.Parse(close ? "M 4.2,4.2 L 15.8,15.8 M 15.8,4.2 L 4.2,15.8" : "M 3.5,10.25 L 16.5,10.25"),
                Stroke = Paint.Solid("#A34F5C65"), StrokeThickness = 1.6, StrokeStartLineCap = PenLineCap.Round, StrokeEndLineCap = PenLineCap.Round,
                Width = 18, Height = 18, Stretch = Stretch.Uniform, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center };
            var button = PlainButton(plate); button.ToolTip = close ? "关闭" : "最小化";
            button.MouseEnter += delegate { plate.Background = Paint.Solid("#57FFFFFF"); };
            button.MouseLeave += delegate { plate.Background = Brushes.Transparent; };
            return button;
        }

        private static Button GlassButton(string text, double width, double height, double radius, double font, string kind, out TextBlock label)
        {
            var plate = Paint.Plate(width, height, radius, kind);
            var scale = new ScaleTransform(1, 1); var offset = new TranslateTransform();
            var transform = new TransformGroup(); transform.Children.Add(scale); transform.Children.Add(offset);
            plate.RenderTransform = transform; plate.RenderTransformOrigin = new Point(.5, .5);
            var gloss = new Border { CornerRadius = new CornerRadius(radius), Background = Paint.Solid("#10FFFFFF"), Opacity = 0, IsHitTestVisible = false };
            plate.Children.Add(gloss);
            var sheenLayer = new Canvas { Width = width, Height = height,
                Clip = new RectangleGeometry(new Rect(0, 0, width, height), radius, radius), IsHitTestVisible = false };
            double sheenWidth = width * .44, sheenStart = -sheenWidth - 16, sheenEnd = width + height * .35 + 16;
            var sweepOffset = new TranslateTransform(sheenStart, 0);
            var sweepTransform = new TransformGroup();
            sweepTransform.Children.Add(new SkewTransform(-12, 0)); sweepTransform.Children.Add(sweepOffset);
            var sheen = new Rectangle { Width = sheenWidth, Height = height * 1.6,
                Fill = Paint.Linear("#00FFFFFF", "#B8FFFFFF", "#00FFFFFF", true),
                Opacity = 0, RenderTransform = sweepTransform };
            Canvas.SetTop(sheen, -height * .3); sheenLayer.Children.Add(sheen); plate.Children.Add(sheenLayer);
            label = Label(text, font, "#33424D", kind == "browse" ? FontWeights.Normal : FontWeights.Medium);
            plate.Children.Add(label);
            var button = PlainButton(plate); button.Width = width; button.Height = height;
            button.MouseEnter += delegate {
                Animate(offset, TranslateTransform.YProperty, kind == "primary" ? -2 : -1, 320);
                Animate(gloss, OpacityProperty, 1, 250);
                if (SystemParameters.ClientAreaAnimation) {
                    // Restart off the left edge; animate the transform, never the layout position.
                    sweepOffset.BeginAnimation(TranslateTransform.XProperty, null);
                    sweepOffset.X = sheenStart;
                    sheen.BeginAnimation(OpacityProperty, null);
                    sheen.Opacity = 1;
                    sweepOffset.BeginAnimation(TranslateTransform.XProperty,
                        new DoubleAnimation(sheenStart, sheenEnd, TimeSpan.FromMilliseconds(750)), HandoffBehavior.SnapshotAndReplace);
                }
            };
            button.MouseLeave += delegate {
                Animate(offset, TranslateTransform.YProperty, 0, 320); Animate(gloss, OpacityProperty, 0, 250); Animate(sheen, OpacityProperty, 0, 180);
                Animate(scale, ScaleTransform.ScaleXProperty, 1, 180); Animate(scale, ScaleTransform.ScaleYProperty, 1, 180);
            };
            button.PreviewMouseLeftButtonDown += delegate {
                Animate(offset, TranslateTransform.YProperty, 0, 130);
                Animate(scale, ScaleTransform.ScaleXProperty, kind == "secondary" ? .979 : .983, 130);
                Animate(scale, ScaleTransform.ScaleYProperty, kind == "secondary" ? .979 : .983, 130);
            };
            button.PreviewMouseLeftButtonUp += delegate {
                Animate(scale, ScaleTransform.ScaleXProperty, 1, 220); Animate(scale, ScaleTransform.ScaleYProperty, 1, 220);
                Animate(offset, TranslateTransform.YProperty, button.IsMouseOver ? (kind == "primary" ? -2 : -1) : 0, 220);
            };
            return button;
        }

        private static string InitialPath()
        {
            using (var key = Registry.CurrentUser.OpenSubKey(@"Software\YuyuPlanner")) {
                var value = key == null ? null : key.GetValue("InstallLocation") as string;
                if (!String.IsNullOrWhiteSpace(value)) return value;
            }
            return System.IO.Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "Little Fish Planner");
        }

        private void Browse()
        {
            using (var dialog = new System.Windows.Forms.FolderBrowserDialog { Description = "选择安装位置", ShowNewFolderButton = false }) {
                if (Directory.Exists(location.Text)) dialog.SelectedPath = location.Text;
                if (dialog.ShowDialog() != System.Windows.Forms.DialogResult.OK) return;
                var path = dialog.SelectedPath.TrimEnd('\\');
                location.Text = String.Equals(System.IO.Path.GetFileName(path), "Little Fish Planner", StringComparison.OrdinalIgnoreCase)
                    ? path : System.IO.Path.Combine(path + (path.Length == 2 ? "\\" : ""), "Little Fish Planner");
            }
        }

        private async Task SimulateInstall()
        {
            if (busy) return; busy = true; install.IsEnabled = false; browse.IsEnabled = false; location.IsReadOnly = true;
            installText.Text = "正在安装";
            await Task.Delay(1400);
            if (closing) return;
            completed = true; busy = false; install.IsEnabled = true;
            installText.Text = "打开"; cancelText.Text = "完成";
            directory.IsHitTestVisible = false;
            Animate(directory, OpacityProperty, 0, 180);
            Animate(directory, HeightProperty, 0, 360); Animate(actionGap, HeightProperty, 32, 360);
            Animate(this, SurfaceHeightProperty, 697, 360);
        }

        // —— 正式安装：界面沿用上面这套，这里只负责校验、解包、调用安装引擎 ——
        private async Task Install()
        {
            if (busy || completed) return;
            string temp = null;
            try
            {
                busy = true; install.IsEnabled = false; browse.IsEnabled = false; location.IsReadOnly = true;
                status.Foreground = Paint.Solid("#627184");
                status.Text = "正在检查安装位置…";
                // 先让界面呈现点击反馈，再做磁盘检查。
                await System.Windows.Threading.Dispatcher.Yield(System.Windows.Threading.DispatcherPriority.Background);
                string target = Program.Destination(location.Text);
                ValidateTarget(target);
                location.Text = target;
                status.Text = "正在准备安装文件…";
                installText.Text = "正在安装";
                progress.Value = 0; progress.IsIndeterminate = false; progress.Visibility = Visibility.Visible;
                temp = Path.Combine(Path.GetTempPath(), "YuyuPlanner-" + Guid.NewGuid().ToString("N"));
                Directory.CreateDirectory(temp);
                string engine = Path.Combine(temp, "install.exe");
                var report = new Progress<double>(value => { progress.Value = value; });
                await Task.Run(() => ExtractEngine(engine, report));
                status.Text = "正在安装鱼鱼日程，请稍候…";
                progress.IsIndeterminate = true;
                int result = await Task.Run(() => RunEngine(engine, target));
                if (result != 0) throw new IOException("安装未完成（错误码 " + result + "）。请确认鱼鱼日程已退出且目录可写，再重试。");
                if (!File.Exists(Path.Combine(target, Program.ExecutableName)))
                    throw new IOException("安装程序已结束，但未找到应用文件，请重新选择目录后安装。");
                installedPath = target;
                progress.IsIndeterminate = false; progress.Value = 100;
                status.Text = "安装完成";
                Complete();
            }
            catch (Exception error)
            {
                progress.Visibility = Visibility.Collapsed;
                ShowError(error.Message);
            }
            finally
            {
                // 只清理这次创建的随机临时目录，绝不递归操作用户选定的安装位置。
                if (temp != null) { try { Directory.Delete(temp, true); } catch (IOException) { } catch (UnauthorizedAccessException) { } }
                busy = false;
                if (installedPath == null)
                {
                    install.IsEnabled = true; browse.IsEnabled = true; location.IsReadOnly = false;
                    installText.Text = "安装";
                }
            }
        }

        private void Complete()
        {
            completed = true; busy = false; install.IsEnabled = true;
            installText.Text = "打开"; cancelText.Text = "完成";
            directory.IsHitTestVisible = false;
            Animate(directory, OpacityProperty, 0, 180);
            Animate(directory, HeightProperty, 0, 360); Animate(actionGap, HeightProperty, 32, 360);
            Animate(this, SurfaceHeightProperty, 697, 360);
        }

        private void Launch()
        {
            try
            {
                Process.Start(new ProcessStartInfo(Path.Combine(installedPath, Program.ExecutableName)) { UseShellExecute = true, WorkingDirectory = installedPath });
                Close();
            }
            catch (Exception error) { ShowError("无法启动鱼鱼日程：" + error.Message); }
        }

        private void ShowError(string message)
        {
            status.Foreground = Paint.Solid("#9B594F");
            status.Text = message;
        }

        private static void ValidateTarget(string target)
        {
            var drive = new DriveInfo(Path.GetPathRoot(target));
            if (!drive.IsReady) throw new IOException("所选磁盘当前不可用，请选择其他位置。");
            if (drive.AvailableFreeSpace < BuildInfo.RequiredBytes) throw new IOException("所选磁盘空间不足，请至少预留 1 GB 可用空间。");
            if (File.Exists(target)) throw new IOException("安装位置已被同名文件占用，请选择其他位置。");
            if (Directory.Exists(target))
            {
                if ((File.GetAttributes(target) & FileAttributes.ReparsePoint) != 0)
                    throw new IOException("安装目录不能是文件夹链接，请选择实际文件夹。");
                if (Directory.EnumerateFileSystemEntries(target).Any()
                    && !(File.Exists(Path.Combine(target, Program.ExecutableName)) && File.Exists(Path.Combine(target, "resources", "app.asar"))))
                    throw new IOException("这个 Little Fish Planner 文件夹已有其他文件，请换一个安装位置。");
            }
            // 不强制结束正在运行的应用，避免打断用户操作。
            if (Process.GetProcessesByName(Program.ProductName).Any())
                throw new IOException("请先从鱼鱼日程的托盘菜单选择“退出”，然后再安装。");
            string parent = Directory.Exists(target) ? target : Path.GetDirectoryName(target);
            while (!Directory.Exists(parent)) parent = Path.GetDirectoryName(parent);
            string probe = Path.Combine(parent, ".little-fish-write-" + Guid.NewGuid().ToString("N"));
            try
            {
                using (var stream = new FileStream(probe, FileMode.CreateNew, FileAccess.Write, FileShare.None, 1, FileOptions.DeleteOnClose)) { }
            }
            catch (UnauthorizedAccessException)
            {
                throw new IOException("当前账户无权写入此位置：" + parent + "，请更换目录，或以管理员身份运行安装包。");
            }
        }

        private static void ExtractEngine(string path, IProgress<double> progress)
        {
            using (var input = Program.Resource("InstallEngine.exe"))
            using (var output = new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.None))
            using (var hash = SHA256.Create())
            {
                byte[] buffer = new byte[1024 * 1024]; long copied = 0; int length;
                while ((length = input.Read(buffer, 0, buffer.Length)) > 0)
                {
                    output.Write(buffer, 0, length); hash.TransformBlock(buffer, 0, length, null, 0);
                    copied += length; progress.Report(copied * 100.0 / input.Length);
                }
                hash.TransformFinalBlock(new byte[0], 0, 0);
                if (!String.Equals(BitConverter.ToString(hash.Hash).Replace("-", ""), BuildInfo.PayloadHash, StringComparison.OrdinalIgnoreCase))
                    throw new InvalidDataException("安装文件校验失败，请重新获取完整安装包。");
            }
        }

        private static int RunEngine(string engine, string target)
        {
            // NSIS 的 /D 必须是最后一个参数，路径不能加引号；校验已拒绝引号与换行。
            var start = new ProcessStartInfo(engine, "/S /currentuser /D=" + target) {
                UseShellExecute = false, CreateNoWindow = true, WorkingDirectory = Path.GetDirectoryName(engine)
            };
            using (var process = Process.Start(start)) { process.WaitForExit(); return process.ExitCode; }
        }

        private static void Animate(Animatable target, DependencyProperty property, double to, int duration)
        { target.BeginAnimation(property, new DoubleAnimation(to, TimeSpan.FromMilliseconds(SystemParameters.ClientAreaAnimation ? duration : 0)) { EasingFunction = new CubicEase { EasingMode = EasingMode.EaseOut } }); }
        private static void Animate(UIElement target, DependencyProperty property, double to, int duration)
        { target.BeginAnimation(property, new DoubleAnimation(to, TimeSpan.FromMilliseconds(SystemParameters.ClientAreaAnimation ? duration : 0)) { EasingFunction = new CubicEase { EasingMode = EasingMode.EaseOut } }); }
        private static void Animate(Animatable target, DependencyProperty property, double from, double to, int duration)
        { target.BeginAnimation(property, new DoubleAnimation(from, to, TimeSpan.FromMilliseconds(duration)) { EasingFunction = new CubicEase { EasingMode = EasingMode.EaseOut } }); }
        private static void Animate(UIElement target, DependencyProperty property, double from, double to, int duration)
        { target.BeginAnimation(property, new DoubleAnimation(from, to, TimeSpan.FromMilliseconds(duration)) { EasingFunction = new CubicEase { EasingMode = EasingMode.EaseOut } }); }
    }

    internal struct Shade
    {
        internal double X, Y, Blur, Alpha; internal Color Color;
        internal Shade(double x, double y, double blur, string color, double alpha)
        { X = x; Y = y; Blur = blur; Color = Paint.ColorOf(color); Alpha = alpha; }
    }

    internal static class Paint
    {
        internal static Color ColorOf(string value) { return (Color)ColorConverter.ConvertFromString(value); }
        internal static SolidColorBrush Solid(string value) { var brush = new SolidColorBrush(ColorOf(value)); brush.Freeze(); return brush; }
        internal static LinearGradientBrush Linear(string first, string middle, string last, bool horizontal = false)
        {
            var brush = new LinearGradientBrush { StartPoint = new Point(0, 0), EndPoint = horizontal ? new Point(1, 0) : new Point(0, 1) };
            brush.GradientStops.Add(new GradientStop(ColorOf(first), 0)); brush.GradientStops.Add(new GradientStop(ColorOf(middle), .5)); brush.GradientStops.Add(new GradientStop(ColorOf(last), 1));
            return brush;
        }

        private static RadialGradientBrush Radial(double cx, double cy, double rx, double ry, string first, double end)
        {
            var brush = new RadialGradientBrush { Center = new Point(cx, cy), GradientOrigin = new Point(cx, cy), RadiusX = rx, RadiusY = ry };
            brush.GradientStops.Add(new GradientStop(ColorOf(first), 0)); brush.GradientStops.Add(new GradientStop(ColorOf("#00FFFFFF"), end)); return brush;
        }

        internal static Grid Plate(double width, double height, double radius, string kind)
        {
            var grid = new Grid { Width = width, Height = height };
            if (kind == "primary") grid.Children.Add(Shadows(width, height, radius, new Shade(-8, 0, 24, "#59FFDC", .27), new Shade(8, 2, 26, "#FF9197", .23), new Shade(0, 16, 36, "#5B6966", .07), new Shade(0, 34, 58, "#8B8E85", .06)));
            else if (kind == "icon") grid.Children.Add(Shadows(width, height, radius, new Shade(0, 26, 48, "#5B6E6B", .13), new Shade(0, 5, 15, "#5F726F", .05), new Shade(-12, 14, 38, "#6BF9D5", .13), new Shade(14, 18, 38, "#FFABAA", .13)));
            else if (kind == "secondary") grid.Children.Add(Shadows(width, height, radius, new Shade(0, 12, 28, "#576865", .05), new Shade(0, 30, 52, "#898B83", .07)));
            else grid.Children.Add(Shadows(width, height, radius, new Shade(0, 10, 24, "#627477", .04), new Shade(0, 28, 48, "#82857C", .075), new Shade(0, 52, 84, "#A69B92", .055)));
            var layers = new Grid { Clip = new RectangleGeometry(new Rect(0, 0, width, height), radius, radius) }; grid.Children.Add(layers);
            if (kind == "primary") {
                layers.Children.Add(new Border { Background = Linear("#75EEFFFA", "#33FFFFFF", "#4DFFE8E9", true) });
                layers.Children.Add(new Border { Background = Radial(1, 0, 1, 1.7, "#3DFFA4A8", .55) });
                layers.Children.Add(new Border { Background = Radial(0, 1, 1.1, 1.6, "#426EFFDC", .57) });
            } else if (kind == "icon") {
                layers.Children.Add(new Border { Background = Solid("#1AFFFFFF") });
                layers.Children.Add(new Border { Background = Radial(.04, .94, .62, .7, "#33B6F7E4", .70) });
                layers.Children.Add(new Border { Background = Radial(.92, .97, .72, .74, "#42FFC0BF", .67) });
                layers.Children.Add(new Border { Background = Radial(.17, 0, .94, .82, "#B8FFFFFF", 1) });
            } else {
                layers.Children.Add(new Border { Background = kind == "path" ? Linear("#8AFFFFFF", "#6CFFFFFF", "#4FFFFFFF") : Linear("#6EFFFFFF", "#53FFFFFF", "#38FFFFFF") });
                if (kind != "path") layers.Children.Add(new Border { Background = Radial(.13, 0, 1.3, 1.5, "#47FFFFFF", .56) });
            }
            if (kind == "icon") grid.Children.Add(new Image { Source = Rim((int)width, (int)height, radius, 1.25, 224, true), IsHitTestVisible = false });
            else grid.Children.Add(new Border { CornerRadius = new CornerRadius(radius), BorderThickness = new Thickness(kind == "path" ? 1 : 2),
                BorderBrush = kind == "primary" ? PrimaryRim() : Linear("#EBFFFFFF", "#64FFFFFF", "#B3FFFFFF"), IsHitTestVisible = false });
            grid.Children.Add(new Border { CornerRadius = new CornerRadius(radius - 1), Margin = new Thickness(1), BorderThickness = new Thickness(0, 1, 0, 1),
                BorderBrush = Linear("#EFFFFFFF", "#00FFFFFF", kind == "primary" ? "#29FFC7C9" : "#78FFFFFF"), IsHitTestVisible = false });
            return grid;
        }

        private static Brush PrimaryRim()
        {
            var b = new LinearGradientBrush { StartPoint = new Point(0, .55), EndPoint = new Point(1, .45) };
            string[] colors = { "#FA73FFE0", "#FAFFFFFF", "#D6FFFFFF", "#F7FFFFFF", "#FAFF9FA5" };
            double[] offsets = { 0, .29, .52, .72, 1 };
            for (int i = 0; i < colors.Length; i++) b.GradientStops.Add(new GradientStop(ColorOf(colors[i]), offsets[i]));
            return b;
        }

        internal static Canvas Shadows(double width, double height, double radius, params Shade[] shades)
        {
            const int pad = 144; int w = (int)width + pad * 2, h = (int)height + pad * 2;
            var data = new byte[w * h * 4];
            for (int y = 0; y < h; y++) for (int x = 0; x < w; x++) {
                double px = x + .5 - pad, py = y + .5 - pad;
                double edge = Distance(px, py, width, height, radius);
                if (edge < -.5) continue;
                double a = 0, r = 0, g = 0, b = 0;
                foreach (var shade in shades) {
                    double d = Distance(px - shade.X, py - shade.Y, width, height, radius);
                    double alpha = shade.Alpha * .5 * (1 - Erf(d / (Math.Max(1, shade.Blur * .5) * 1.41421356))) * Math.Min(1, edge + .5);
                    r = shade.Color.R / 255.0 * alpha + r * (1 - alpha); g = shade.Color.G / 255.0 * alpha + g * (1 - alpha);
                    b = shade.Color.B / 255.0 * alpha + b * (1 - alpha); a = alpha + a * (1 - alpha);
                }
                Pixel(data, (y * w + x) * 4, r, g, b, a);
            }
            var image = new Image { Source = Bitmap(w, h, data), Width = w, Height = h, IsHitTestVisible = false };
            Canvas.SetLeft(image, -pad); Canvas.SetTop(image, -pad);
            var layer = new Canvas { IsHitTestVisible = false }; layer.Children.Add(image); return layer;
        }

        internal static Grid FrameShadows(double width, double height, double radius, params Shade[] shades)
        {
            var source = (BitmapSource)((Image)Shadows(width, height, radius, shades).Children[0]).Source;
            return StretchFrame(source, (int)radius + 144, 144);
        }

        // Keep corner radii and shadow blur unchanged while the completed window contracts.
        internal static Grid StretchFrame(BitmapSource source, int inset, int overhang)
        {
            var frame = new Grid { Margin = new Thickness(-overhang), IsHitTestVisible = false };
            for (int i = 0; i < 3; i++) {
                var length = i == 1 ? new GridLength(1, GridUnitType.Star) : new GridLength(inset);
                frame.RowDefinitions.Add(new RowDefinition { Height = length });
                frame.ColumnDefinitions.Add(new ColumnDefinition { Width = length });
            }
            int[] xs = { 0, inset, source.PixelWidth - inset, source.PixelWidth };
            int[] ys = { 0, inset, source.PixelHeight - inset, source.PixelHeight };
            for (int row = 0; row < 3; row++) for (int col = 0; col < 3; col++) {
                var brush = new ImageBrush(source) { ViewboxUnits = BrushMappingMode.Absolute,
                    Viewbox = new Rect(xs[col], ys[row], xs[col + 1] - xs[col], ys[row + 1] - ys[row]), Stretch = Stretch.Fill };
                var cell = new Border { Background = brush }; Grid.SetRow(cell, row); Grid.SetColumn(cell, col); frame.Children.Add(cell);
            }
            return frame;
        }

        private static double Erf(double x)
        {
            double sign = x < 0 ? -1 : 1; x = Math.Abs(x); double t = 1 / (1 + .3275911 * x);
            return sign * (1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - .284496736) * t + .254829592) * t * Math.Exp(-x * x));
        }
        private static double Distance(double x, double y, double w, double h, double radius)
        { double dx = Math.Abs(x - w / 2) - w / 2 + radius, dy = Math.Abs(y - h / 2) - h / 2 + radius; return Math.Sqrt(Math.Max(dx, 0) * Math.Max(dx, 0) + Math.Max(dy, 0) * Math.Max(dy, 0)) + Math.Min(Math.Max(dx, dy), 0) - radius; }

        internal static BitmapSource Rim(int w, int h, double radius, double thickness, double start, bool icon)
        {
            var data = new byte[w * h * 4];
            double[] stops = icon ? new[] { 0.0, .24, .47, .72, 1 } : new[] { 0.0, 28.0 / 360, 82.0 / 360, 154.0 / 360, 222.0 / 360, 280.0 / 360, 326.0 / 360, 1 };
            string[] values = icon ? new[] { "#FAFFFFFF", "#AD85FADB", "#D9FFFFFF", "#A3FFB5B5", "#FAFFFFFF" } : new[] { "#FAFFFFFF", "#B8A2FCE2", "#F0FFFFFF", "#94FFFFFF", "#99FFB4B5", "#F5FFFFFF", "#94B1FFE8", "#FAFFFFFF" };
            var colors = new Color[values.Length]; for (int i = 0; i < colors.Length; i++) colors[i] = ColorOf(values[i]);
            for (int y = 0; y < h; y++) for (int x = 0; x < w; x++) {
                double d = Distance(x + .5, y + .5, w, h, radius);
                double coverage = Math.Max(0, Math.Min(1, .5 - d)) * Math.Max(0, Math.Min(1, d + thickness + .5));
                if (coverage == 0) continue;
                double angle = ((Math.Atan2(x + .5 - w / 2.0, -(y + .5 - h / 2.0)) * 180 / Math.PI - start) % 360 + 360) % 360 / 360;
                int i = 1; while (i < stops.Length - 1 && angle > stops[i]) i++;
                double t = (angle - stops[i - 1]) / (stops[i] - stops[i - 1]); Color l = colors[i - 1], r = colors[i];
                double a = (l.A + (r.A - l.A) * t) / 255 * coverage;
                Pixel(data, (y * w + x) * 4, (l.R + (r.R - l.R) * t) / 255 * a, (l.G + (r.G - l.G) * t) / 255 * a, (l.B + (r.B - l.B) * t) / 255 * a, a);
            }
            return Bitmap(w, h, data);
        }

        internal static BitmapSource PanelBackdrop()
        {
            const int w = 1080, h = 850; var data = new byte[w * h * 4];
            for (int y = 0; y < h; y++) for (int x = 0; x < w; x++) {
                double u = (x + .5) / w, v = (y + .5) / h, r = 1, g = 1, b = 1;
                Blend(.10, 255, 250, 249, ref r, ref g, ref b);
                Wash(u, v, .51, 1.06, .68, .34, .15, 220, 187, 184, .05, 239, 212, 208, .48, .75, ref r, ref g, ref b);
                Wash(u, v, .95, 1.05, .62, .33, .30, 145, 191, 179, .11, 190, 220, 211, .45, .73, ref r, ref g, ref b);
                Wash(u, v, .09, 1.03, .60, .31, .32, 255, 170, 173, .12, 255, 198, 197, .43, .72, ref r, ref g, ref b);
                Wash(u, v, .97, .38, .64, .66, .22, 255, 196, 201, .10, 255, 211, 214, .40, .69, ref r, ref g, ref b);
                Wash(u, v, .07, .27, .72, .64, .28, 169, 240, 222, .11, 188, 245, 230, .40, .68, ref r, ref g, ref b);
                Wash(u, v, .17, 0, .52, .23, .45, 255, 255, 255, 0, 255, 255, 255, .73, .74, ref r, ref g, ref b);
                Pixel(data, (y * w + x) * 4, r, g, b, 1);
            }
            return Bitmap(w, h, data);
        }
        private static void Wash(double u, double v, double cx, double cy, double rx, double ry, double a0, double r0, double g0, double b0, double a1, double r1, double g1, double b1, double middle, double end, ref double r, ref double g, ref double b)
        {
            double dx = (u - cx) / rx, dy = (v - cy) / ry, d = Math.Sqrt(dx * dx + dy * dy); if (d >= end) return;
            if (d <= middle) { double t = d / middle; Blend(a0 + (a1 - a0) * t, r0 + (r1 - r0) * t, g0 + (g1 - g0) * t, b0 + (b1 - b0) * t, ref r, ref g, ref b); }
            else Blend(a1 * (1 - (d - middle) / (end - middle)), r1, g1, b1, ref r, ref g, ref b);
        }
        private static void Blend(double a, double sr, double sg, double sb, ref double r, ref double g, ref double b)
        { r = sr / 255 * a + r * (1 - a); g = sg / 255 * a + g * (1 - a); b = sb / 255 * a + b * (1 - a); }
        private static void Pixel(byte[] data, int i, double r, double g, double b, double a)
        { data[i] = Byte(b); data[i + 1] = Byte(g); data[i + 2] = Byte(r); data[i + 3] = Byte(a); }
        private static byte Byte(double n) { return (byte)Math.Max(0, Math.Min(255, Math.Round(n * 255))); }
        private static BitmapSource Bitmap(int w, int h, byte[] data)
        { var image = BitmapSource.Create(w, h, 96, 96, PixelFormats.Pbgra32, null, data, w * 4); image.Freeze(); return image; }
    }
}
