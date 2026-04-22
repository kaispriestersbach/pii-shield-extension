# Privacy Review Hardening Plan

Dieser Plan basiert auf `review.md` im Arbeitsverzeichnis und auf dem aktuellen
Stand von `main` (`8336e1c`). Einige Punkte aus der Review sind auf `main`
bereits teilweise adressiert; der neue Hardening-Branch sollte die verbleibenden
Risiken in kleinen, testbaren Schritten schließen.

## Umsetzung in diesem Branch

- Content-Banner schreibt keine Originalwerte oder Fake-Werte mehr in die
  Webseiten-DOM.
- Paste-Fehler sind fail-closed: bei AI-Fehler, Parsefehler oder Timeout wird
  nichts eingefuegt.
- Das Popup fragt den AI-Status ueber `GET_AI_STATUS` im Service Worker ab.
- Copy-Deanonymisierung nutzt eine lokale Mapping-Kopie im Content Script und
  laeuft synchron innerhalb des Copy-Events.
- Mappings bleiben in `chrome.storage.session`, werden bei Tab-Schliessung,
  Navigation, explizitem Clear und nach TTL bereinigt.
- Die Prompt API nutzt strukturierte Ausgabe ueber `responseConstraint`.
- Deterministische Detektoren fuer E-Mail, IBAN, Kreditkarte, Telefon, IP und
  Datum ergaenzen die KI-Erkennung.
- Die Replacement-Engine ersetzt atomar ueber Spans und verhindert Kaskaden.
- `clipboardRead` und `clipboardWrite` wurden aus dem Manifest entfernt.
- README und Tests wurden an die gehaertete Architektur angepasst.

## Status auf `main`

- `chrome.storage.session` wird fuer PII-Mappings bereits verwendet; alte
  `chrome.storage.local`-Mappings werden beim Start geloescht.
- Paste-Fehler werden nicht mehr stillschweigend als Originaltext eingefuegt;
  aktuell kann der Nutzer das Einfuegen aber per `confirm()` trotzdem erlauben.
- Die Replacement-Logik ist in `replacement-engine.js` extrahiert und hat
  Node-Tests, ist aber noch nicht atomar gegen Kaskaden/Kollisionen abgesichert.
- Der Content-Banner schreibt weiterhin Originalwerte in die Webseiten-DOM.
- Der Copy-Handler wartet weiterhin asynchron auf den Service Worker, bevor er
  `preventDefault()` ausfuehrt.
- Das Popup prueft den echten AI-Status im Service Worker weiterhin nicht.

## Phase 1: Kritische Privacy-Leaks schliessen

1. Content-Banner datensparsam machen
   - In `content.js` keine Original-PII und idealerweise auch keine Fake-Werte
     mehr in die Host-DOM rendern.
   - Banner nur mit Anzahl/Kategorien anzeigen, z. B. "3 Elemente anonymisiert".
   - Details bleiben ausschliesslich im Extension-Popup oder einer Extension-
     Seite, nie im Chatbot-Dokument.
   - Test: DOM-Snapshot/Unit-Test oder manuelle DevTools-Pruefung, dass
     `#pii-shield-banner` keine Originalwerte enthaelt.

2. Fail-closed konsequent machen
   - Bei `ai_unavailable`, `parse_failed`, Timeout oder Service-Worker-Fehlern
     den Paste-Vorgang blockieren und nur eine Warnung anzeigen.
   - Die aktuelle `confirm()`-Ausnahme entfernen oder in eine explizite
     "unsicher einfuegen"-Funktion ausserhalb des automatischen Paste-Flows
     verschieben.
   - Fehlerantworten duerfen den Originaltext intern weiter enthalten, aber der
     Content-Code darf ihn nicht automatisch einfuegen.

3. AI-Verfuegbarkeit als echte Schutzbedingung behandeln
   - Im Background eine Message `GET_AI_STATUS` einfuehren, die
     `LanguageModel.availability()` aus genau dem Kontext prueft, der spaeter
     anonymisiert.
   - Popup und Content Script nutzen diesen Status fuer klare Meldungen:
     `available`, `downloadable`, `downloading`, `unavailable`, `error`.

## Phase 2: Copy/Mapping zuverlässig und fluechtig halten

4. Copy-Handler synchron machen
   - Reverse-Mappings im Content Script lokal spiegeln, sobald Paste-Ergebnisse
     zurueckkommen.
   - Beim Start per `GET_MAPPINGS` initialisieren und bei `CLEAR_*` aktualisieren.
   - Im `copy`-Event synchron deanonymisieren, sofort `preventDefault()` setzen
     und `event.clipboardData.setData()` aufrufen.
   - Der Service Worker bleibt die Quelle fuer Speicherung, aber nicht mehr auf
     dem kritischen Copy-Event-Pfad.

5. Mapping-Lifecycle haerten
   - `chrome.storage.session` beibehalten, keine Rueckkehr zu `storage.local`.
   - Mappings bei Tab-Removal, Navigation/Hostwechsel und explizitem Clear
     loeschen.
   - Optional: kurze Inaktivitaets-TTL pro Tab, damit PII nicht laenger als
     noetig im Speicher bleibt.

## Phase 3: Erkennung und Ersetzung robuster machen

6. Strukturierte Prompt-Ausgabe nutzen und validieren
   - `session.prompt(prompt, { responseConstraint })` mit JSON-Schema verwenden.
   - Antwort strikt als Array strukturierter Entities validieren:
     `original`, `replacement`, `category`, optional `start`, `end`,
     `confidence`.
   - Ungueltige, leere, doppelte oder nicht im Text enthaltene Originale
     verwerfen; bei unsicherer Antwort fail-closed oder deterministische
     Fallbacks anwenden.

7. Deterministische Fallback-Detektoren ergänzen
   - Regex-/Validator-Fallbacks fuer E-Mail, IBAN, Kreditkarte mit Luhn,
     Telefonnummern, IPv4/IPv6 und einfache Datumsformate.
   - Diese Treffer laufen unabhaengig vom LLM und verhindern, dass einfache
     Prompt-Injection-Texte zu `{}` fuehren.
   - Fake-Werte deterministisch und formatwahrend erzeugen, damit Tests
     reproduzierbar bleiben.

8. Replacement-Engine atomar umbauen
   - Aus Originaltreffern erst nicht ueberlappende Spans bilden, laengere und
     spezifischere Treffer priorisieren.
   - In einem Pass von rechts nach links oder ueber Platzhalter ersetzen, damit
     `A -> B` und `B -> C` nicht kaskadieren.
   - Fake-Werte eindeutig machen und Kollisionen ablehnen oder suffixen.
   - Tests fuer Kaskaden, ueberlappende Treffer, doppelte Fake-Werte und
     zufaellige Fake-Substring-Vorkommen ergaenzen.

## Phase 4: Berechtigungen, UI und Dokumentation angleichen

9. Clipboard-Berechtigungen minimieren
   - `clipboardRead` entfernen, solange nur `event.clipboardData` genutzt wird.
   - `clipboardWrite` ebenfalls entfernen, wenn die synchrone Event-Clipboard-
     Strategie reicht; nur behalten, falls eine getestete Clipboard-API-
     Fallback-Route eingefuehrt wird.

10. Editor-Integration regressionstesten
    - Bestehende `beforeinput`/React-kompatible Eingabe beibehalten.
    - Manuelle Smoke-Tests auf ChatGPT, Claude, Gemini, Mistral, Copilot und
      DeepSeek dokumentieren.
    - `execCommand` nur als Chromium-Kompatibilitaetsfallback behalten und in
      der README ehrlich so beschreiben.

11. README und Produktversprechen korrigieren
    - Versprechen auf "best effort, lokal, fail-closed" anpassen.
    - Klarstellen, dass LLM-Erkennung probabilistisch ist und deterministische
      Validatoren nur bestimmte Kategorien absichern.
    - Architektur-Abschnitt aktualisieren: `storage.session`, keine PII im
      Host-DOM, synchroner Copy-Pfad.

## Empfohlene Umsetzungsschnitte

1. `privacy-banner-and-fail-closed`
   - Banner bereinigen, `confirm()` aus Fehlerpfaden entfernen,
     `GET_AI_STATUS` einfuehren, README-Minimalupdate.

2. `sync-copy-and-session-lifecycle`
   - Lokale Reverse-Mapping-Spiegelung im Content Script, synchroner Copy-
     Handler, Clear-/Navigation-Sync, Tests fuer Mapping-Lifecycle.

3. `structured-detection-and-fallbacks`
   - JSON-Schema, strikte Validierung, deterministische Detektoren und
     Fake-Generatoren.

4. `atomic-replacement-engine`
   - Span-basierte Replacement-Engine und erweiterte Node-Test-Suite.

## Validierung

- `node tests/replacement-engine.test.mjs`
- Neue Node-Tests fuer Detektoren, Schema-Validierung und Replacement-Spans.
- Manuelle Extension-Smoke-Tests in Chrome 138+:
  - Paste mit PII anonymisiert und schreibt keine Originalwerte in die DOM.
  - AI-Ausfall blockiert Paste.
  - Copy ersetzt bekannte Fake-Werte synchron.
  - Clear entfernt Mappings im Popup und im Content Script.
  - Manifest funktioniert ohne unnoetige Clipboard-Permissions.
