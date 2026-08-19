Art for action outcomes — see docs/todo.md item 17.

The files, 16:9, resized like the portraits (sources in the gitignored
faction_portraits/, as with the diplomacy set):
  refusal.jpeg      your institutions will not carry the order out
  defiance.jpeg     they objected and did it anyway
  negotiation.jpeg  it needs another power to agree

  sips -Z 1000 --setProperty formatOptions 75 <source> --out web/public/events/<name>.jpeg

A missing file must fall back to the text treatment, never to a hole.
