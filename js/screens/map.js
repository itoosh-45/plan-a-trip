// Temporary compatibility shim for clients that still have the old maps tab cached.
// The current application no longer registers or exposes the maps screen.
export async function mount(host) {
  const message = document.createElement('p');
  message.textContent = 'מסך המפות הוסר. רעננו את האפליקציה לגרסה החדשה.';
  host.append(message);
}
