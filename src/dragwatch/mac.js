// JXA (osascript -l JavaScript) drag watcher for macOS — no native module needed.
// Prints "drag 1" when an OS drag session starts (mouse button held AND the system drag pasteboard
// changed since the button went down) and "drag 0" when the button is released. Also "files 1|0".
ObjC.import('AppKit');
ObjC.import('Foundation');
var out = $.NSFileHandle.fileHandleWithStandardOutput;
function emit(s) { out.writeData($(s + '\n').dataUsingEncoding($.NSUTF8StringEncoding)); }
var name = $.NSPasteboardNameDrag;
if (!name || typeof name === 'undefined') name = $('Apple CFPasteboard drag');
var pb = $.NSPasteboard.pasteboardWithName(name);
var wasDown = false, downCount = 0, dragging = false;
emit('ready');
while (true) {
  var down = ($.NSEvent.pressedMouseButtons & 1) === 1;
  var cc = pb.changeCount;
  if (down && !wasDown) downCount = cc;
  if (down && !dragging && cc !== downCount) {
    dragging = true;
    var files = false;
    try { var t = ObjC.deepUnwrap(pb.types) || []; files = t.indexOf('public.file-url') >= 0 || t.indexOf('NSFilenamesPboardType') >= 0; } catch (e) {}
    emit('files ' + (files ? 1 : 0));
    emit('drag 1');
  }
  if (!down && dragging) { dragging = false; emit('drag 0'); }
  wasDown = down;
  delay(0.04);
}
