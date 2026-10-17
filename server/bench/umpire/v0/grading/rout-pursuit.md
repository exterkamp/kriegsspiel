# Case rout-pursuit: A broken battalion pursued by cavalry

**What this case tests.** Red-1 broke at the bridge last turn and is running north. Blue cavalry, across the bridge, is ordered to pursue but not past the wood line; Red-2 is ordered to rally the fugitives behind it. A good umpire lets the cavalry cut up the fugitives (losses and maybe prisoners for Red-1, few for Blue-3), keeps Red-1 broken unless a roll is asked for a rally, and has Red-2 cover the retreat. Consistency: losses from the previous turn are not undone.

## The umpire's input

```json
{
 "turn": 2,
 "startMinute": 20,
 "endMinute": 40,
 "turnMinutes": 20,
 "dial": "standard",
 "departureTolerance": {
  "metres": 100,
  "lossShareOfStrength": 0.05
 },
 "map": {
  "widthM": 4000,
  "heightM": 3000,
  "features": [
   {
    "id": "north-wood",
    "kind": "wood",
    "name": "Northern wood",
    "layer": 1,
    "geometry": {
     "shape": "polygon",
     "points": [
      {
       "x": 600,
       "y": 300
      },
      {
       "x": 1300,
       "y": 350
      },
      {
       "x": 1250,
       "y": 900
      },
      {
       "x": 650,
       "y": 850
      }
     ]
    },
    "attrs": {
     "moveCost": 3,
     "cover": 0.5,
     "concealment": 1,
     "height": "flat",
     "passable": true
    }
   },
   {
    "id": "south-wood",
    "kind": "wood",
    "name": "Southern wood",
    "layer": 1,
    "geometry": {
     "shape": "polygon",
     "points": [
      {
       "x": 2700,
       "y": 1900
      },
      {
       "x": 3400,
       "y": 1950
      },
      {
       "x": 3350,
       "y": 2500
      },
      {
       "x": 2750,
       "y": 2450
      }
     ]
    },
    "attrs": {
     "moveCost": 3,
     "cover": 0.5,
     "concealment": 1,
     "height": "flat",
     "passable": true
    }
   },
   {
    "id": "river",
    "kind": "river",
    "name": "The river",
    "layer": 3,
    "geometry": {
     "shape": "polyline",
     "points": [
      {
       "x": 0,
       "y": 1500
      },
      {
       "x": 4000,
       "y": 1500
      }
     ],
     "width": 200
    },
    "attrs": {
     "moveCost": 1,
     "cover": 0,
     "concealment": 0,
     "height": "low",
     "passable": false
    }
   },
   {
    "id": "high-road",
    "kind": "road",
    "name": "High road",
    "layer": 2,
    "geometry": {
     "shape": "polyline",
     "points": [
      {
       "x": 2050,
       "y": 0
      },
      {
       "x": 2050,
       "y": 3000
      }
     ],
     "width": 20
    },
    "attrs": {
     "moveCost": 0.5,
     "cover": 0,
     "concealment": 0,
     "height": "flat",
     "passable": true
    }
   },
   {
    "id": "bridge",
    "kind": "bridge",
    "name": "The bridge",
    "layer": 4,
    "geometry": {
     "shape": "point",
     "at": {
      "x": 2050,
      "y": 1500
     },
     "radius": 110
    },
    "attrs": {
     "moveCost": 1,
     "cover": 0,
     "concealment": 0,
     "height": "flat",
     "passable": true
    }
   }
  ]
 },
 "victory": {
  "objective": [
   {
    "x": 2020,
    "y": 1470
   },
   {
    "x": 2080,
    "y": 1470
   },
   {
    "x": 2080,
    "y": 1530
   },
   {
    "x": 2020,
    "y": 1530
   }
  ],
  "defender": "blue",
  "attacker": "red",
  "holdMinutes": 50
 },
 "sides": [
  {
   "id": "blue",
   "name": "Blue",
   "hq": {
    "x": 2050,
    "y": 2950
   }
  },
  {
   "id": "red",
   "name": "Red",
   "hq": {
    "x": 2050,
    "y": 50
   }
  }
 ],
 "units": [
  {
   "id": "blue-1",
   "side": "blue",
   "name": "1st Battalion",
   "type": "line_infantry",
   "kind": "infantry",
   "commander": "Col. Aubry",
   "personality": [
    "literal"
   ],
   "character": "steady and methodical; holds a line under fire",
   "x": 1980,
   "y": 1660,
   "facingDeg": 0,
   "formation": "line",
   "strength": 565,
   "morale": 78,
   "fatigue": 20,
   "ammo": 100,
   "status": "active",
   "continuingFromLastTurn": {
    "kind": "hold"
   },
   "marchMetresPerTurnOpenGround": 2000,
   "fireRangeM": 200,
   "sightRangeM": 600,
   "breakMorale": 25
  },
  {
   "id": "blue-2",
   "side": "blue",
   "name": "2nd Battalion",
   "type": "line_infantry",
   "kind": "infantry",
   "commander": "Col. Delacroix",
   "personality": [
    "cautious"
   ],
   "character": "cautious; slow to commit his reserve",
   "x": 2120,
   "y": 1660,
   "facingDeg": 0,
   "formation": "line",
   "strength": 525,
   "morale": 75,
   "fatigue": 20,
   "ammo": 100,
   "status": "active",
   "continuingFromLastTurn": {
    "kind": "hold"
   },
   "marchMetresPerTurnOpenGround": 2000,
   "fireRangeM": 200,
   "sightRangeM": 600,
   "breakMorale": 25
  },
  {
   "id": "blue-3",
   "side": "blue",
   "name": "Cavalry Squadron",
   "type": "cavalry",
   "kind": "cavalry",
   "commander": "Maj. Verneuil",
   "personality": [
    "aggressive",
    "initiative"
   ],
   "character": "bold and impatient; apt to charge early",
   "x": 2050,
   "y": 1330,
   "facingDeg": 0,
   "formation": "line",
   "strength": 200,
   "morale": 85,
   "fatigue": 15,
   "ammo": 100,
   "status": "active",
   "continuingFromLastTurn": {
    "kind": "hold"
   },
   "marchMetresPerTurnOpenGround": 6000,
   "fireRangeM": 100,
   "sightRangeM": 800,
   "breakMorale": 25
  },
  {
   "id": "red-1",
   "side": "red",
   "name": "Vanguard Battalion",
   "type": "line_infantry",
   "kind": "infantry",
   "commander": "Col. Brandt",
   "personality": [
    "aggressive"
   ],
   "character": "aggressive; presses the attack hard",
   "x": 2050,
   "y": 1080,
   "facingDeg": 0,
   "formation": "loose",
   "strength": 380,
   "morale": 18,
   "fatigue": 60,
   "ammo": 100,
   "status": "broken",
   "brokeAtMinute": 16,
   "continuingFromLastTurn": {
    "kind": "move",
    "x": 1950,
    "y": 300
   },
   "marchMetresPerTurnOpenGround": 1600,
   "fireRangeM": 200,
   "sightRangeM": 600,
   "breakMorale": 25
  },
  {
   "id": "red-2",
   "side": "red",
   "name": "Line Battalion",
   "type": "line_infantry",
   "kind": "infantry",
   "commander": "Col. Hartmann",
   "personality": [],
   "character": "by the book; waits for orders",
   "x": 2150,
   "y": 700,
   "facingDeg": 180,
   "formation": "line",
   "strength": 650,
   "morale": 70,
   "fatigue": 25,
   "ammo": 100,
   "status": "active",
   "continuingFromLastTurn": {
    "kind": "hold"
   },
   "marchMetresPerTurnOpenGround": 1950,
   "fireRangeM": 200,
   "sightRangeM": 600,
   "breakMorale": 25
  },
  {
   "id": "red-3",
   "side": "red",
   "name": "Hussar Squadron",
   "type": "cavalry",
   "kind": "cavalry",
   "commander": "Maj. von Reiter",
   "personality": [],
   "character": "dashing scout; prone to over-reach",
   "x": 1550,
   "y": 400,
   "facingDeg": 180,
   "formation": "line",
   "strength": 220,
   "morale": 85,
   "fatigue": 0,
   "ammo": 100,
   "status": "active",
   "continuingFromLastTurn": {
    "kind": "hold"
   },
   "marchMetresPerTurnOpenGround": 6000,
   "fireRangeM": 100,
   "sightRangeM": 800,
   "breakMorale": 25
  }
 ],
 "orders": [
  {
   "orderId": "b3-5",
   "side": "blue",
   "to": "blue-3",
   "text": "Pursue the broken battalion up the road and take prisoners, but do not go past the line of the northern wood. Come back if you meet formed infantry.",
   "courier": "fast",
   "sentTurn": 2,
   "status": "arrived",
   "arrivedAtMinuteOfTurn": 2
  },
  {
   "orderId": "r2-5",
   "side": "red",
   "to": "red-2",
   "text": "Form line across the road, let the Vanguard pass through you, and stop the enemy horse.",
   "courier": "fast",
   "sentTurn": 2,
   "status": "arrived",
   "arrivedAtMinuteOfTurn": 3
  }
 ],
 "previousTurn": "Turn 1: the Vanguard Battalion stormed the bridge in column and was thrown back by the volleys of the 1st and 2nd Battalions, losing about 270 men; it broke at minute 16 and fled north up the high road. Blue lost about 60 men. The Cavalry Squadron crossed the bridge at the end of the turn.",
 "projection": {
  "units": [
   {
    "unitId": "blue-1",
    "x": 1980,
    "y": 1660,
    "facingDeg": 0,
    "formation": "line",
    "strength": 565,
    "morale": 78,
    "fatigue": 16,
    "ammo": 100,
    "status": "active",
    "continuing": {
     "kind": "hold"
    }
   },
   {
    "unitId": "blue-2",
    "x": 2120,
    "y": 1660,
    "facingDeg": 0,
    "formation": "line",
    "strength": 525,
    "morale": 75,
    "fatigue": 16,
    "ammo": 100,
    "status": "active",
    "continuing": {
     "kind": "hold"
    }
   },
   {
    "unitId": "blue-3",
    "x": 2050,
    "y": 1850,
    "facingDeg": 45,
    "formation": "line",
    "strength": 147,
    "morale": 14,
    "fatigue": 34,
    "ammo": 70,
    "status": "broken",
    "continuing": {
     "kind": "idle"
    }
   },
   {
    "unitId": "red-1",
    "x": 1957,
    "y": 300,
    "facingDeg": 0,
    "formation": "loose",
    "strength": 380,
    "morale": 40,
    "fatigue": 53,
    "ammo": 100,
    "status": "active",
    "continuing": {
     "kind": "idle"
    }
   },
   {
    "unitId": "red-2",
    "x": 2100,
    "y": 750,
    "facingDeg": 225,
    "formation": "line",
    "strength": 621,
    "morale": 61,
    "fatigue": 39,
    "ammo": 65,
    "status": "active",
    "continuing": {
     "kind": "hold"
    }
   },
   {
    "unitId": "red-3",
    "x": 2050,
    "y": 1766,
    "facingDeg": 180,
    "formation": "line",
    "strength": 220,
    "morale": 85,
    "fatigue": 1,
    "ammo": 100,
    "status": "active",
    "continuing": {
     "kind": "move",
     "x": 2050,
     "y": 1766
    }
   }
  ],
  "events": [
   "minute 2: unit.rallyFailed {\"unitId\":\"red-1\",\"reason\":\"die\",\"die\":2}",
   "minute 3: unit.arrived {\"unitId\":\"blue-3\",\"at\":[2050,800]}",
   "minute 4: unit.arrived {\"unitId\":\"red-2\",\"at\":[2100,750]}",
   "minute 4: unit.rallyFailed {\"unitId\":\"red-1\",\"reason\":\"pressed\"}",
   "minute 5: combat.morale {\"unitId\":\"blue-3\",\"lossPercent\":5.2,\"roll\":11,\"needed\":9,\"passed\":false,\"morale\":70.6}",
   "minute 5: combat.fire {\"attacker\":\"blue-3\",\"target\":\"red-2\",\"distance\":70.7,\"cover\":1,\"aspect\":\"front\",\"melee\":false,\"die\":6,\"casualties\":8.9,\"targetStrength\":641.1,\"targetMorale\":67.3}",
   "minute 5: combat.fire {\"attacker\":\"red-2\",\"target\":\"blue-3\",\"distance\":70.7,\"cover\":1,\"aspect\":\"front\",\"melee\":false,\"die\":3,\"casualties\":10.4,\"targetStrength\":189.6,\"targetMorale\":70.6}",
   "minute 6: unit.rallied {\"unitId\":\"red-1\",\"die\":6,\"morale\":40}",
   "minute 7: combat.fire {\"attacker\":\"blue-3\",\"target\":\"red-2\",\"distance\":70.7,\"cover\":1,\"aspect\":\"front\",\"melee\":false,\"die\":5,\"casualties\":6.5,\"targetStrength\":634.6,\"targetMorale\":65.2}",
   "minute 7: combat.fire {\"attacker\":\"red-2\",\"target\":\"blue-3\",\"distance\":70.7,\"cover\":1,\"aspect\":\"front\",\"melee\":false,\"die\":2,\"casualties\":6.8,\"targetStrength\":182.8,\"targetMorale\":63.4}",
   "minute 9: combat.fire {\"attacker\":\"blue-3\",\"target\":\"red-2\",\"distance\":70.7,\"cover\":1,\"aspect\":\"front\",\"melee\":false,\"die\":2,\"casualties\":2.4,\"targetStrength\":632.1,\"targetMorale\":64.5}",
   "minute 9: combat.fire {\"attacker\":\"red-2\",\"target\":\"blue-3\",\"distance\":70.7,\"cover\":1,\"aspect\":\"front\",\"melee\":false,\"die\":1,\"casualties\":3.3,\"targetStrength\":179.5,\"targetMorale\":59.8}",
   "minute 11: combat.fire {\"attacker\":\"blue-3\",\"target\":\"red-2\",\"distance\":70.7,\"cover\":1,\"aspect\":\"front\",\"melee\":false,\"die\":3,\"casualties\":3.5,\"targetStrength\":628.7,\"targetMorale\":63.4}",
   "minute 11: combat.fire {\"attacker\":\"red-2\",\"target\":\"blue-3\",\"distance\":70.7,\"cover\":1,\"aspect\":\"front\",\"melee\":false,\"die\":1,\"casualties\":3.3,\"targetStrength\":176.2,\"targetMorale\":56.2}",
   "minute 13: combat.morale {\"unitId\":\"blue-3\",\"lossPercent\":11,\"roll\":11,\"needed\":4,\"passed\":false,\"morale\":30.2}",
   "minute 13: combat.fire {\"attacker\":\"blue-3\",\"target\":\"red-2\",\"distance\":70.7,\"cover\":1,\"aspect\":\"front\",\"melee\":false,\"die\":5,\"casualties\":5.5,\"targetStrength\":623.1,\"targetMorale\":61.6}",
   "minute 13: combat.fire {\"attacker\":\"red-2\",\"target\":\"blue-3\",\"distance\":70.7,\"cover\":1,\"aspect\":\"front\",\"melee\":false,\"die\":6,\"casualties\":19.4,\"targetStrength\":156.8,\"targetMorale\":30.2}",
   "minute 15: combat.morale {\"unitId\":\"blue-3\",\"lossPercent\":6.1,\"roll\":3,\"needed\":2,\"passed\":false,\"morale\":14}",
   "minute 15: combat.fire {\"attacker\":\"blue-3\",\"target\":\"red-2\",\"distance\":70.7,\"cover\":1,\"aspect\":\"front\",\"melee\":false,\"die\":3,\"casualties\":2.5,\"targetStrength\":620.7,\"targetMorale\":60.8}",
   "minute 15: combat.fire {\"attacker\":\"red-2\",\"target\":\"blue-3\",\"distance\":70.7,\"cover\":1,\"aspect\":\"front\",\"melee\":false,\"die\":3,\"casualties\":9.5,\"targetStrength\":147.3,\"targetMorale\":14}",
   "minute 15: unit.broken {\"unitId\":\"blue-3\",\"morale\":14}",
   "minute 17: unit.arrived {\"unitId\":\"blue-3\",\"at\":[2050,1850]}"
  ]
 }
}
```

## Proposal A

```json
(no answer)
```

## Proposal B

```json
(no answer)
```

## Proposal C

```json
(no answer)
```

## Proposal D

```json
{
 "turn": 2,
 "units": [
  {
   "unitId": "blue-1",
   "x": 1980,
   "y": 1660,
   "facingDeg": 0,
   "formation": "line",
   "strength": 565,
   "morale": 79,
   "fatigue": 16,
   "ammo": 100,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [],
   "account": "Col. Aubry had no new orders. He held his line south of the bridge and rested his men after the morning's fight."
  },
  {
   "unitId": "blue-2",
   "x": 2120,
   "y": 1660,
   "facingDeg": 0,
   "formation": "line",
   "strength": 525,
   "morale": 76,
   "fatigue": 16,
   "ammo": 100,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [],
   "account": "Col. Delacroix had no new orders and held his line, content to let the cavalry do the chasing."
  },
  {
   "unitId": "blue-3",
   "x": 2050,
   "y": 1350,
   "facingDeg": 0,
   "formation": "line",
   "strength": 191,
   "morale": 84,
   "fatigue": 32,
   "ammo": 95,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [
    {
     "orderId": "b3-5",
     "result": "carried-out"
    }
   ],
   "account": "Maj. Verneuil was off the moment the order came. He rode into the fleeing battalion on the road, cut down the stragglers and rounded up about sixty prisoners. Nearing the line of the northern wood, he saw a fresh battalion formed in line across the road ahead. A volley emptied a few saddles. As ordered, he would not charge formed infantry, so he wheeled about and brought his prisoners back to the bridge.",
   "departure": "The engine had the squadron ride up to a formed line and trade carbine fire with it for ten minutes until it broke. The order says to come back on meeting formed infantry, so it turned back after one volley, losing 9 men, and ends at the bridge, active and in good heart."
  },
  {
   "unitId": "red-1",
   "x": 2000,
   "y": 450,
   "facingDeg": 0,
   "formation": "loose",
   "strength": 302,
   "morale": 22,
   "fatigue": 62,
   "ammo": 100,
   "status": "broken",
   "continuing": {
    "kind": "move",
    "x": 1950,
    "y": 300
   },
   "orders": [],
   "account": "Col. Brandt could not rally his men under the sabres of the pursuing horse. About sixty were taken and some twenty cut down before the fugitives streamed through the gaps in the Line Battalion. Behind its cover he is gathering what is left near the rally point, but the men are not yet steady.",
   "departure": "The engine rallied the battalion at minute 6, while enemy cavalry were among its fugitives. Being ridden down and losing about 80 men, 60 of them taken prisoner, it stays broken this turn, though the pursuit has stopped and it is near its rally point. The prisoners also make the loss larger than the engine's."
  },
  {
   "unitId": "red-2",
   "x": 2050,
   "y": 750,
   "facingDeg": 180,
   "formation": "line",
   "strength": 649,
   "morale": 71,
   "fatigue": 31,
   "ammo": 96,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [
    {
     "orderId": "r2-5",
     "result": "carried-out"
    }
   ],
   "account": "Col. Hartmann did it by the book. He shifted his line west to straddle the road, opened files for the Vanguard's fugitives to pass, and closed them again. When the enemy horse came on he gave them a volley at about 130 m, and they turned back. He holds the road."
  },
  {
   "unitId": "red-3",
   "x": 1550,
   "y": 400,
   "facingDeg": 180,
   "formation": "line",
   "strength": 220,
   "morale": 85,
   "fatigue": 0,
   "ammo": 100,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [],
   "account": "Maj. von Reiter had no orders and held his squadron west of the road, watching the Vanguard stream back.",
   "departure": "The engine sent the squadron, which had no orders, over the bridge and through the Blue line to (2050,1766). It had no orders and could not have passed the bridge through the enemy, so it stayed put."
  }
 ],
 "observations": [
  {
   "side": "blue",
   "by": "blue-3",
   "unitId": "red-1",
   "when": "start"
  },
  {
   "side": "blue",
   "by": "blue-3",
   "unitId": "red-2",
   "when": "start"
  },
  {
   "side": "blue",
   "by": "blue-1",
   "unitId": "red-1",
   "when": "start"
  },
  {
   "side": "blue",
   "by": "blue-2",
   "unitId": "red-1",
   "when": "start"
  },
  {
   "side": "red",
   "by": "red-1",
   "unitId": "blue-3",
   "when": "start"
  },
  {
   "side": "red",
   "by": "red-1",
   "unitId": "blue-1",
   "when": "start"
  },
  {
   "side": "red",
   "by": "red-1",
   "unitId": "blue-2",
   "when": "start"
  },
  {
   "side": "blue",
   "by": "blue-3",
   "unitId": "red-2",
   "when": "end"
  }
 ],
 "summary": "Turn 2 (20-40). Blue's cavalry squadron received its pursuit order at minute 2 and rode into Red's broken Vanguard on the high road. It cut down about 20 and took about 60 prisoners. Red's Line Battalion received its order at minute 3, shifted west to straddle the road at (2050,750) and let the fugitives pass through. Nearing the line of the northern wood around minute 7, the squadron met this formed line, took a volley at about 130 m and lost 9 men. As its order required, it came back on meeting formed infantry, bringing its prisoners to the north end of the bridge. The Vanguard, down to about 300 men, is still broken but out of reach, gathering near its rally point at about (2000,450). Blue's two battalions held south of the bridge. Red's hussars stayed west of the road without orders. The engine's projection was rejected: it had the squadron stand ten minutes in a firefight until it broke, and the hussars ride through the Blue position."
}
```

## Proposal E

```json
{
 "turn": 2,
 "units": [
  {
   "unitId": "blue-1",
   "x": 1980,
   "y": 1660,
   "facingDeg": 0,
   "formation": "line",
   "strength": 565,
   "morale": 78,
   "fatigue": 16,
   "ammo": 100,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [],
   "account": "Col. Aubry has no new order and holds his line south of the river, facing the bridge. He sees the cavalry go out and come back, and nothing threatens him."
  },
  {
   "unitId": "blue-2",
   "x": 2120,
   "y": 1660,
   "facingDeg": 0,
   "formation": "line",
   "strength": 525,
   "morale": 75,
   "fatigue": 16,
   "ammo": 100,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [],
   "account": "Col. Delacroix has no new order and holds his line beside the 1st Battalion. He sees nothing to commit his reserve to."
  },
  {
   "unitId": "blue-3",
   "x": 2050,
   "y": 1330,
   "facingDeg": 0,
   "formation": "line",
   "strength": 183,
   "morale": 88,
   "fatigue": 35,
   "ammo": 100,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [
    {
     "orderId": "b3-5",
     "result": "carried-out"
    }
   ],
   "account": "Maj. Verneuil gets his order in the second minute and goes at once after the fugitives, who are strung out on the road about 250 m ahead. He rides them down in a couple of minutes, sabring many and taking a good number of prisoners, and drives the rest on. At the level of the southern edge of the northern wood, which is the limit he was given, he sees a fresh battalion forming line across the road ahead, at about 150 m. Obeying his order, he breaks off, takes a volley from the battalion as he turns, and rides back to the north bank of the river, where he re-forms.",
   "departure": "Projection holds the cavalry in a long duel with a formed battalion at 70 m, at the end of which it breaks and flees to (2050,1850) with 147 men. Verneuil's order is to come back if he meets formed infantry, and he does, so he breaks off after a single volley at 150 m rather than standing, ending at (2050,1330), active and with 183 men."
  },
  {
   "unitId": "red-1",
   "x": 2050,
   "y": 550,
   "facingDeg": 0,
   "formation": "column",
   "strength": 270,
   "morale": 35,
   "fatigue": 62,
   "ammo": 100,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [],
   "account": "Col. Brandt has no new order, and his broken men are running up the road. The horse is on them within two minutes, and about a hundred are cut down or taken before they reach the line of the second battalion drawn across the road. They pass through its intervals and he rallies the survivors behind it, with the enemy horse turned back. He re-forms what is left in column and stays behind the line.",
   "departure": "Projection keeps the Vanguard at 380 men, rallied by minute 6 and at (1957,300), as if untouched by the pursuit. With the enemy horse ordered to pursue it and riding it down on the open road, about 110 men are lost, and it ends at (2050,550) with 270 men, well over the 5% tolerance."
  },
  {
   "unitId": "red-2",
   "x": 2050,
   "y": 730,
   "facingDeg": 180,
   "formation": "line",
   "strength": 650,
   "morale": 68,
   "fatigue": 28,
   "ammo": 92,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [
    {
     "orderId": "r2-5",
     "result": "carried-out"
    }
   ],
   "account": "Col. Hartmann gets the order at about the third minute and forms his battalion in line across the road, as ordered, facing south. He opens his intervals to the Vanguard's fugitives and lets them pass through, then closes up and fires one volley at the enemy horse at about 150 m as it breaks off. It has been stopped, so he does not pursue."
  },
  {
   "unitId": "red-3",
   "x": 1550,
   "y": 400,
   "facingDeg": 180,
   "formation": "line",
   "strength": 220,
   "morale": 85,
   "fatigue": 0,
   "ammo": 100,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [],
   "account": "Maj. von Reiter has no order and holds his position at the edge of the northern wood, watching.",
   "departure": "Projection sends the hussars to (2050,1766), in the Blue rear, though there is no order to do so. With no order they stay where they are, so the position differs by well over 100 m."
  }
 ],
 "observations": [
  {
   "side": "blue",
   "by": "blue-3",
   "unitId": "red-1",
   "when": "start"
  },
  {
   "side": "blue",
   "by": "blue-3",
   "unitId": "red-2",
   "when": "start"
  },
  {
   "side": "blue",
   "by": "blue-1",
   "unitId": "red-1",
   "when": "start"
  },
  {
   "side": "blue",
   "by": "blue-2",
   "unitId": "red-1",
   "when": "start"
  },
  {
   "side": "red",
   "by": "red-1",
   "unitId": "blue-3",
   "when": "start"
  },
  {
   "side": "red",
   "by": "red-1",
   "unitId": "blue-1",
   "when": "start"
  },
  {
   "side": "red",
   "by": "red-1",
   "unitId": "blue-2",
   "when": "start"
  },
  {
   "side": "blue",
   "by": "blue-3",
   "unitId": "red-2",
   "when": "end"
  },
  {
   "side": "blue",
   "by": "blue-3",
   "unitId": "red-1",
   "when": "end"
  }
 ],
 "summary": "Blue-3 received its order in the second minute and rode down the broken Vanguard Battalion on the open road. About 110 of its men were cut down or taken. Verneuil stopped at the level of the southern edge of the northern wood, as ordered, on seeing Red-2 forming line across the road. The Vanguard's survivors passed through Red-2's intervals and rallied behind it, with about 270 men and morale 35. Red-2 gave the cavalry a single volley at about 150 m as it broke off, and Blue-3 rode back to the north bank of the river, with about 17 men lost. The projection had Blue-3 stand and fight the battalion and break; the umpire has it obey its order to come back. Red-3 held; the projection moves it without orders. Blue-1 and Blue-2 held and were not engaged."
}
```

## Proposal F

```json
{
 "turn": 2,
 "units": [
  {
   "unitId": "blue-1",
   "x": 1980,
   "y": 1660,
   "facingDeg": 0,
   "formation": "line",
   "strength": 565,
   "morale": 78,
   "fatigue": 16,
   "ammo": 100,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [],
   "account": "The 1st Battalion acted as the staff tables direct."
  },
  {
   "unitId": "blue-2",
   "x": 2120,
   "y": 1660,
   "facingDeg": 0,
   "formation": "line",
   "strength": 525,
   "morale": 75,
   "fatigue": 16,
   "ammo": 100,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [],
   "account": "The 2nd Battalion acted as the staff tables direct."
  },
  {
   "unitId": "blue-3",
   "x": 2050,
   "y": 1850,
   "facingDeg": 45,
   "formation": "line",
   "strength": 147,
   "morale": 14,
   "fatigue": 34,
   "ammo": 70,
   "status": "broken",
   "continuing": {
    "kind": "idle"
   },
   "orders": [
    {
     "orderId": "b3-5",
     "result": "carried-out"
    }
   ],
   "account": "The Cavalry Squadron acted as the staff tables direct."
  },
  {
   "unitId": "red-1",
   "x": 1957,
   "y": 300,
   "facingDeg": 0,
   "formation": "loose",
   "strength": 380,
   "morale": 40,
   "fatigue": 53,
   "ammo": 100,
   "status": "active",
   "continuing": {
    "kind": "idle"
   },
   "orders": [],
   "account": "The Vanguard Battalion acted as the staff tables direct."
  },
  {
   "unitId": "red-2",
   "x": 2100,
   "y": 750,
   "facingDeg": 225,
   "formation": "line",
   "strength": 621,
   "morale": 61,
   "fatigue": 39,
   "ammo": 65,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [
    {
     "orderId": "r2-5",
     "result": "carried-out"
    }
   ],
   "account": "The Line Battalion acted as the staff tables direct."
  },
  {
   "unitId": "red-3",
   "x": 2050,
   "y": 1766,
   "facingDeg": 180,
   "formation": "line",
   "strength": 220,
   "morale": 85,
   "fatigue": 1,
   "ammo": 100,
   "status": "active",
   "continuing": {
    "kind": "move",
    "x": 2050,
    "y": 1766
   },
   "orders": [],
   "account": "The Hussar Squadron acted as the staff tables direct."
  }
 ],
 "observations": [],
 "summary": "The turn was resolved by the tables."
}
```
