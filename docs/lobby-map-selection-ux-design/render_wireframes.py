"""Task-owned static SVG wireframes. No application imports or runtime changes."""
from pathlib import Path
from html import escape

OUT = Path(__file__).resolve().parent
INK, MUTED, PAPER, PAGE, RULE, CONTROL = '#2a2118', '#51442c', '#f4eedb', '#e9dcb8', '#6f6038', '#efe6c8'
OK, WARN, WAX = '#2f6b2f', '#7a5200', '#8a1c10'

class SVG:
    def __init__(self, w, h, title):
        self.parts = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}" role="img"><title>{escape(title)}</title>',
                      f'<rect width="{w}" height="{h}" fill="{PAGE}"/>']
    def rect(self, x, y, w, h, fill=PAPER, stroke=RULE):
        self.parts.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="3" fill="{fill}" stroke="{stroke}"/>')
    def text(self, x, y, text, size=16, color=INK, bold=False):
        self.parts.append(f'<text x="{x}" y="{y}" font-family="Georgia, serif" font-size="{size}" fill="{color}" font-weight="{"bold" if bold else "normal"}">{escape(text)}</text>')
    def lines(self, x, y, lines, size=16, color=INK, leading=24):
        for i, t in enumerate(lines): self.text(x, y+i*leading, t, size, color)
    def button(self, x, y, w, label, primary=False, disabled=False):
        self.rect(x,y,w,44,INK if primary and not disabled else CONTROL, RULE)
        self.text(x+12,y+28,label,15,PAPER if primary and not disabled else MUTED if disabled else INK)
        if disabled: self.text(x+w-16,y+28,'–',14,MUTED)
    def field(self, x,y,w,label,value):
        self.text(x,y,label,16,INK,True)
        self.rect(x,y+12,w,44,CONTROL)
        self.text(x+12,y+40,value,16)
    def map(self,x,y,w,h,bridge=True):
        self.rect(x,y,w,h,'#d8cfa0')
        if bridge:
            self.parts.append(f'<path d="M{x} {y+h*.51} Q{x+w*.24} {y+h*.4} {x+w*.53} {y+h*.52} T{x+w} {y+h*.5}" fill="none" stroke="#8fb4cc" stroke-width="{h*.11}"/>')
        self.parts.append(f'<path d="M{x+w*.51} {y} L{x+w*.54} {y+h}" stroke="#a8885a" stroke-width="6"/>')
        if bridge: self.rect(x+w*.50,y+h*.45,w*.08,h*.14,CONTROL)
        else:
            self.parts.append(f'<path d="M{x} {y+h*.62} L{x+w*.8} {y+h*.47} L{x+w} {y+h*.60}" fill="none" stroke="#a8885a" stroke-width="4"/>')
            for j in range(3): self.rect(x+w*(.65+j*.06),y+h*.4,w*.025,h*.05,CONTROL)
        self.parts.append(f'<path d="M{x+w*.12} {y+h*.13} L{x+w*.36} {y+h*.1} L{x+w*.33} {y+h*.35} L{x+w*.13} {y+h*.32} Z" fill="#8fa36b"/>')
        self.parts.append(f'<path d="M{x+w*.68} {y+h*.66} L{x+w*.91} {y+h*.69} L{x+w*.89} {y+h*.91} L{x+w*.7} {y+h*.9} Z" fill="#8fa36b"/>')
        self.text(x+w-26,y+24,'N',14,INK,True)
        self.text(x+10,y+h-10,'Public terrain · schematic',12,MUTED)
    def save(self,name):
        (OUT/name).write_text('\n'.join(self.parts)+ '\n</svg>\n')

def newgame(s,x,y,w,narrow=False):
    s.text(x,y,'← Main menu',15)
    s.text(x,y+48,'New game',34,INK,True)
    s.rect(x,y+72,w,154)
    s.text(x+14,y+100,'Scenario',19,INK,True)
    s.text(x+14,y+131,'◉ Hold the Bridge',18,INK,True)
    s.lines(x+14,y+163,['Blue defends the crossing; Red advances.', 'Blue must hold for 50 minutes.'],15)
    s.text(x+14,y+212,'▸ Armies and objectives',15)
    top=y+248
    s.rect(x,top,w,398)
    s.text(x+14,top+29,'Battlefield map',19,INK,True)
    s.map(x+14,top+45,w-28,146)
    s.text(x+14,top+223,'The bridge battlefield',19,INK,True)
    s.text(x+14,top+250,'4 × 3 km · Scenario default',16,MUTED)
    s.text(x+14,top+277,'Ready for Hold the Bridge',16,OK,True)
    s.lines(x+14,top+303,['Scenario supplies armies, starting', 'positions and objectives.'],15,MUTED,21)
    s.button(x+14,top+346,126,'Choose map')
    s.button(x+150,top+346,104,'Add map')
    if not narrow: s.button(x+264,top+346,104,'View map')
    else: s.text(x+w-78,top+336,'View map',14,WAX)
    t=top+420
    s.rect(x,t,w,98)
    s.text(x+14,t+27,'Your side',18,INK,True)
    s.text(x+14,t+53,'Blue',16)
    s.text(x+14,t+79,'A computer opponent plays Red.',15,MUTED)
    s.rect(x,t+118,w,88)
    s.text(x+14,t+145,'How the game is played',18,INK,True)
    s.text(x+14,t+175,'◉ Real time     ○ Turns, umpire decides',14)
    s.text(x,t+232,'Timing and umpire settings continue below.',14,MUTED)
    s.rect(x,t+254,w,68,PAGE)
    s.button(x+10,t+266,128,'Start game',True)
    s.button(x+150,t+266,76,'Back')
    s.text(x,t+350,'Your games',20,INK,True)

def chooser(s,x,y,w,narrow=False):
    s.text(x,y,'Choose battlefield map',27,INK,True)
    s.text(x,y+31,'For Hold the Bridge',16,MUTED)
    s.text(x,y+71,'◉ Scenario maps     ○ My maps',16)
    s.button(x,y+91,106,'Add map')
    s.text(x,y+167,'◉ The bridge battlefield',18,INK,True)
    s.text(x+24,y+194,'4 × 3 km · Scenario default',15,MUTED)
    s.text(x+24,y+220,'Ready for Hold the Bridge',15,OK,True)
    s.rect(x,y+239,w,1,RULE)
    s.text(x,y+270,'Other included maps',18,INK,True)
    s.text(x,y+301,'○ Countryside — 5 × 3 km',16)
    s.text(x+24,y+326,'Needs a scenario',15,WARN)
    s.text(x,y+357,'○ Wooded hills — 5 × 5 km',16)
    s.text(x+24,y+382,'Needs a scenario',15,WARN)
    s.text(x,y+413,'○ River valley — 5 × 5 km',16)
    s.text(x+24,y+438,'Needs a scenario',15,WARN)
    s.map(x,y+463,w,183)
    s.button(x,y+659,96,'Fit map')
    s.button(x+106,y+659,52,'−')
    s.button(x+168,y+659,52,'+')
    s.text(x,y+738,'The bridge battlefield',20,INK,True)
    s.lines(x,y+772,['The current scenario is prepared for', 'this map. Other saved terrain needs', 'an approved scenario before play.'],16,MUTED,24)
    s.rect(x,y+863,w,68,PAGE)
    s.button(x+10,y+875,92,'Cancel')
    s.button(x+w-130,y+875,120,'Use map',True)
    s.text(x,y+964,'Selection previews; Use map confirms.',14,MUTED)

def addmap(s,x,y,w,narrow=False):
    s.text(x,y,'Add battlefield map',28,INK,True)
    s.text(x,y+36,'← Back to maps',15)
    s.lines(x,y+76,['Create terrain for your map library.', 'A map needs a scenario with armies', 'and objectives before it can be played.'],16,MUTED,24)
    s.field(x,y+174,w,'Landscape','Countryside                       ▾')
    s.field(x,y+260,w,'Map size','5 × 5 km                            ▾')
    s.text(x,y+349,'▸ Repeat this map',16)
    s.button(x,y+370,152,'Generate map')
    s.map(x,y+441,w,168,False)
    s.text(x,y+639,'Unsaved map · 5 × 5 km',18,INK,True)
    s.field(x,y+681,w,'Map name','My countryside')
    s.text(x,y+765,'Needs a scenario',17,WARN,True)
    s.text(x,y+794,'Saving adds terrain, not a playable game.',14,MUTED)
    s.text(x,y+834,'▸ Already have a map? Import map file',14)
    s.rect(x,y+863,w,68,PAGE)
    s.button(x+10,y+875,92,'Cancel')
    s.button(x+w-136,y+875,126,'Save map',True)
    s.text(x,y+964,'After saving: Done → My maps.',14,MUTED)

def desktop_chooser(s,x,y,w):
    s.text(x,y,'Choose battlefield map',28,INK,True)
    s.text(x,y+32,'For Hold the Bridge',16,MUTED)
    s.text(x,y+78,'◉ Scenario maps     ○ My maps',16)
    s.button(x,y+101,106,'Add map')
    s.text(x,y+185,'◉ The bridge battlefield',18,INK,True)
    s.text(x+24,y+215,'4 × 3 km · Scenario default',15,MUTED)
    s.text(x+24,y+242,'Ready for Hold the Bridge',15,OK,True)
    s.text(x,y+289,'Other included maps',18,INK,True)
    for i,name in enumerate(['Countryside — 5 × 3 km','Wooded hills — 5 × 5 km','River valley — 5 × 5 km']):
        s.text(x,y+323+i*57,'○ '+name,16)
        s.text(x+24,y+347+i*57,'Needs a scenario',15,WARN)
    rx=x+330
    s.map(rx,y+78,w-330,249)
    s.button(rx,y+342,96,'Fit map')
    s.button(rx+108,y+342,52,'−')
    s.button(rx+172,y+342,52,'+')
    s.text(rx,y+420,'The bridge battlefield · 4 × 3 km',21,INK,True)
    s.text(rx,y+454,'Ready for Hold the Bridge',17,OK,True)
    s.lines(rx,y+485,['The scenario supplies armies, starting positions', 'and objectives. Selecting a row only previews it.'],16,MUTED,24)
    s.rect(x,y+548,w,68,PAGE)
    s.button(x+12,y+560,92,'Cancel')
    s.button(x+w-132,y+560,120,'Use map',True)

def desktop_add(s,x,y,w):
    s.text(x,y,'Add battlefield map',28,INK,True)
    s.text(x,y+34,'← Back to maps',16)
    s.lines(x,y+77,['Create terrain for your map library. A map needs a scenario with armies and objectives before it can be played.'],16,MUTED)
    s.field(x,y+125,290,'Landscape','Countryside                     ▾')
    s.field(x,y+212,290,'Map size','5 × 5 km                          ▾')
    s.text(x,y+304,'▸ Repeat this map',16)
    s.button(x,y+325,152,'Generate map')
    s.text(x,y+410,'▸ Already have a map?',16)
    s.text(x,y+440,'Import map file',16,WAX)
    rx=x+330
    s.map(rx,y+110,w-330,214,False)
    s.text(rx,y+357,'Unsaved map · 5 × 5 km',21,INK,True)
    s.field(rx,y+400,w-330,'Map name','My countryside')
    s.text(rx,y+485,'Needs a scenario',17,WARN,True)
    s.text(rx,y+514,'Saving adds terrain, not a playable game.',16,MUTED)
    s.rect(x,y+548,w,68,PAGE)
    s.button(x+12,y+560,92,'Cancel')
    s.button(x+w-138,y+560,126,'Save map',True)

s=SVG(1660,1640,'Desktop lobby map-selection recommendation: entry and two-column map dialogs')
s.text(40,44,'LOBBY MAP SELECTION · DESKTOP DESIGN',24,INK,True)
s.text(40,76,'Proposed UI. Add/generate requires durable storage; unpaired terrain cannot start a live battle.',17,MUTED)
for x,y,w,h,title in [(40,124,580,1092,'1 / New game entry'),(650,124,970,698,'2 / Choose saved or default'),(650,868,970,698,'3 / Add and save geography')]:
    s.text(x,y,title,20,INK,True)
    s.rect(x,y+20,w,h)
newgame(s,60,184,540)
desktop_chooser(s,674,193,922)
desktop_add(s,674,937,922)
s.lines(40,1310,['THE SAME NEW GAME DRAFT', 'Both dialogs overlay the retained form.', 'Cancel returns to the original selection.', 'Use map confirms only an approved pairing.', 'Save map adds geography to the library.', 'Only Start game creates and starts play.'],17,MUTED,32)
s.text(40,1608,'Paper/ink controls follow Angular shell tokens. Public terrain thumbnails are schematic; lower form settings abbreviated.',16,MUTED)
s.save('desktop.svg')

s=SVG(1250,1400,'Narrow-screen lobby map-selection recommendation at 390 CSS pixels per frame')
s.text(24,38,'NARROW SCREEN · 390 px FRAMES',23,INK,True)
s.text(24,70,'Paper dialogs scroll vertically; footer actions remain visible. Static target wireframes.',16,MUTED)
for x,title in [(24,'1 / New game'),(430,'2 / Choose map'),(836,'3 / Add map')]:
    s.text(x,112,title,19,INK,True)
    s.rect(x,133,390,1156)
newgame(s,40,175,358,True)
chooser(s,446,180,358,True)
addmap(s,852,180,358,True)
s.lines(24,1331,['No map operation creates a game. Use map confirms a pairing; Save map only saves geography.',
                 'The Add map target ships after storage prerequisites. Immediate UX explains current availability.'],16,MUTED)
s.save('narrow.svg')
