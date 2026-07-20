export function SettingsPage(): JSX.Element {
  return (
    <main className="settings">
      <h1>Settings</h1>
      <section>
        <h2>Notifcation Preferences</h2>
        <label>
          <input type="checkbox" defaultChecked />
          Email me about account activity
        </label>
      </section>
    </main>
  );
}
