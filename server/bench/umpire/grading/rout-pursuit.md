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
    "kind": "withdraw",
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
   "orderId": "blue-b3-5",
   "side": "blue",
   "to": "blue-3",
   "text": "Pursue the broken battalion up the road and take prisoners, but do not go past the line of the northern wood. Come back if you meet formed infantry.",
   "courier": "fast",
   "sentAtMinute": 20,
   "status": "arrived",
   "arrivedAtMinuteOfTurn": 2
  },
  {
   "orderId": "red-r2-5",
   "side": "red",
   "to": "red-2",
   "text": "Form line across the road, let the Vanguard pass through you, and stop the enemy horse.",
   "courier": "fast",
   "sentAtMinute": 20,
   "status": "arrived",
   "arrivedAtMinuteOfTurn": 3
  }
 ],
 "journal": {
  "notes": [
   {
    "turn": 1,
    "note": "Turn 1: the Vanguard Battalion stormed the bridge in column and was thrown back by the volleys of the 1st and 2nd Battalions, losing about 270 men; it broke at minute 16 and fled north up the high road. Blue lost about 60 men. The Cavalry Squadron crossed the bridge at the end of the turn."
   }
  ],
  "precedents": []
 },
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
    "fatigue": 12,
    "ammo": 100,
    "status": "active",
    "continuing": {
     "kind": "hold"
    },
    "at": "near the bridge, west of the High road"
   },
   {
    "unitId": "blue-2",
    "x": 2120,
    "y": 1660,
    "facingDeg": 0,
    "formation": "line",
    "strength": 525,
    "morale": 75,
    "fatigue": 12,
    "ammo": 100,
    "status": "active",
    "continuing": {
     "kind": "hold"
    },
    "at": "near the bridge, east of the High road"
   },
   {
    "unitId": "blue-3",
    "x": 2050,
    "y": 1330,
    "facingDeg": 0,
    "formation": "line",
    "strength": 200,
    "morale": 85,
    "fatigue": 7,
    "ammo": 100,
    "status": "active",
    "continuing": {
     "kind": "hold"
    },
    "at": "near the bridge, on the High road"
   },
   {
    "unitId": "red-1",
    "x": 2050,
    "y": 442,
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
    "at": "on the High road",
    "path": [
     [
      2050,
      1080
     ],
     [
      2050,
      442
     ]
    ]
   },
   {
    "unitId": "red-2",
    "x": 2150,
    "y": 700,
    "facingDeg": 180,
    "formation": "line",
    "strength": 650,
    "morale": 70,
    "fatigue": 17,
    "ammo": 100,
    "status": "active",
    "continuing": {
     "kind": "hold"
    },
    "at": "east of the High road"
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
    "at": "near the Northern wood"
   }
  ],
  "observations": [
   {
    "side": "blue",
    "unitId": "red-1",
    "by": "blue-1",
    "when": "start"
   },
   {
    "side": "blue",
    "unitId": "red-2",
    "by": "blue-3",
    "when": "start"
   },
   {
    "side": "red",
    "unitId": "blue-1",
    "by": "red-1",
    "when": "start"
   },
   {
    "side": "red",
    "unitId": "blue-2",
    "by": "red-1",
    "when": "start"
   },
   {
    "side": "red",
    "unitId": "blue-3",
    "by": "red-1",
    "when": "start"
   },
   {
    "side": "blue",
    "unitId": "red-2",
    "by": "blue-3",
    "when": "end"
   }
  ],
  "events": [
   "22: unit.rallyFailed red-1, reason die",
   "22: order_delivered blue-3, orderId blue-b3-5",
   "23: order_delivered red-2, orderId red-r2-5",
   "24: unit.rallied red-1"
  ]
 }
}
```

## Proposal A

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
   "fatigue": 12,
   "ammo": 100,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [],
   "account": "Col. Aubry held his line west of the road by the bridge, rested his men and watched the road north. No enemy came within reach."
  },
  {
   "unitId": "blue-2",
   "x": 2120,
   "y": 1660,
   "facingDeg": 0,
   "formation": "line",
   "strength": 525,
   "morale": 75,
   "fatigue": 12,
   "ammo": 100,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [],
   "account": "Col. Delacroix kept his battalion in place east of the road, as before. He saw no reason to move his reserve and did not."
  },
  {
   "unitId": "blue-3",
   "x": 2050,
   "y": 1020,
   "facingDeg": 0,
   "formation": "line",
   "strength": 197,
   "morale": 87,
   "fatigue": 25,
   "ammo": 100,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [
    {
     "orderId": "blue-b3-5",
     "result": "carried-out"
    }
   ],
   "account": "Maj. Verneuil rode north up the road at once and overtook the tail of the broken battalion near the southern edge of the northern wood. He sabred and took a number of stragglers. Then he saw a formed line of infantry across the road ahead, and as ordered he drew off out of musket range. He halted short of the wood, facing north, and kept the enemy line under watch.",
   "departure": "Red-1 loses about 70 men and ends with lower morale than projected because the cavalry, ordered to pursue, overtook its rear. The engine projection had no contact."
  },
  {
   "unitId": "red-1",
   "x": 2050,
   "y": 450,
   "facingDeg": 0,
   "formation": "loose",
   "strength": 310,
   "morale": 33,
   "fatigue": 55,
   "ammo": 100,
   "status": "active",
   "continuing": {
    "kind": "idle"
   },
   "orders": [],
   "account": "Col. Brandt got his men in hand and moved them up the road. Enemy horse caught the rear of the column and cut off or sabred a number of stragglers. The rest passed through the line forming across the road and went on north, shaken but still under his hand.",
   "departure": "Losses about 70 men (over 5% of strength) and morale 33 rather than 40: Blue's cavalry, ordered to pursue the broken battalion, caught its rear on the road. The projection had no contact."
  },
  {
   "unitId": "red-2",
   "x": 2050,
   "y": 700,
   "facingDeg": 180,
   "formation": "line",
   "strength": 650,
   "morale": 70,
   "fatigue": 17,
   "ammo": 100,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [
    {
     "orderId": "red-r2-5",
     "result": "carried-out"
    }
   ],
   "account": "Col. Hartmann shifted his battalion west onto the road and formed line across it facing south. He opened ranks for the Vanguard to pass through. The enemy horse came into view but did not close with him, and he held his ground."
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
   "account": "Maj. von Reiter had no fresh orders and kept his squadron at the Northern wood."
  }
 ],
 "observations": [
  {
   "side": "blue",
   "unitId": "red-1",
   "by": "blue-1",
   "when": "start"
  },
  {
   "side": "blue",
   "unitId": "red-2",
   "by": "blue-3",
   "when": "start"
  },
  {
   "side": "red",
   "unitId": "blue-1",
   "by": "red-1",
   "when": "start"
  },
  {
   "side": "red",
   "unitId": "blue-2",
   "by": "red-1",
   "when": "start"
  },
  {
   "side": "red",
   "unitId": "blue-3",
   "by": "red-1",
   "when": "start"
  },
  {
   "side": "blue",
   "unitId": "red-2",
   "by": "blue-3",
   "when": "end"
  },
  {
   "side": "blue",
   "unitId": "red-1",
   "by": "blue-3",
   "when": "end"
  },
  {
   "side": "red",
   "unitId": "blue-3",
   "by": "red-2",
   "when": "end"
  }
 ],
 "summary": "Blue's cavalry rode up the road, overtook the rear of the Vanguard Battalion near the northern wood and took or cut down about 70 men. The Vanguard had rallied at minute 24 and stayed active at morale 33. Seeing formed infantry across the road, the cavalry drew back to y=1020 out of musket range, as ordered. Red's Line Battalion formed across the road at y=700 facing south and let the Vanguard through. The Vanguard is withdrawing to about y=450. Blue's infantry held at the bridge and Red's hussars stayed at the wood. Next turn: watch for the cavalry's next move against Red's line, and for the Vanguard's recovery."
}
```

## Proposal B

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
   "fatigue": 12,
   "ammo": 100,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [],
   "account": "Col. Aubry had no new orders and held his line south of the bridge as last instructed. The men rested and dressed ranks while the squadron went over the bridge ahead."
  },
  {
   "unitId": "blue-2",
   "x": 2120,
   "y": 1660,
   "facingDeg": 0,
   "formation": "line",
   "strength": 525,
   "morale": 75,
   "fatigue": 12,
   "ammo": 100,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [],
   "account": "Col. Delacroix had no new orders and kept his battalion in line east of the road, covering the bridge. He made no move to follow the horse forward."
  },
  {
   "unitId": "blue-3",
   "x": 2050,
   "y": 1300,
   "facingDeg": 0,
   "formation": "line",
   "strength": 192,
   "morale": 84,
   "fatigue": 24,
   "ammo": 100,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [
    {
     "orderId": "blue-b3-5",
     "result": "carried-out"
    }
   ],
   "account": "Maj. Verneuil went up the road at the gallop as soon as the order came. He rode into the tail of the beaten battalion short of the wood line and cut off about forty stragglers. A fresh enemy battalion stood in line across the road beyond them and fired a long volley. As ordered, he did not charge formed infantry. He wheeled about and brought the squadron and its prisoners back to the north end of the bridge.",
   "departure": "The projection left the squadron idle although its pursuit order arrived at minute 2. A bold major with an explicit order rides out. He returns before the end of the turn as the order requires once he meets formed infantry, so his end position is near the projected one. He loses 8 men to the long volley."
  },
  {
   "unitId": "red-1",
   "x": 2050,
   "y": 460,
   "facingDeg": 0,
   "formation": "loose",
   "strength": 340,
   "morale": 34,
   "fatigue": 56,
   "ammo": 100,
   "status": "active",
   "continuing": {
    "kind": "idle"
   },
   "orders": [],
   "account": "Col. Brandt's men streamed north up the road with enemy horse at their heels. The rearmost were ridden down and taken. The rest passed through the gaps of the line battalion in front of them, and behind it the officers got them halted and collected. The battalion is shaken and weak.",
   "departure": "About 40 men are lost as prisoners to the enemy squadron's pursuit, which the projection did not run. Morale recovers less than projected for the same reason. The rally is kept as the projection has it, since the battalion found cover behind a formed line."
  },
  {
   "unitId": "red-2",
   "x": 2050,
   "y": 700,
   "facingDeg": 180,
   "formation": "line",
   "strength": 650,
   "morale": 71,
   "fatigue": 19,
   "ammo": 97,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [
    {
     "orderId": "red-r2-5",
     "result": "carried-out"
    }
   ],
   "account": "Col. Hartmann shifted his line west until it stood square across the road. He opened files to let the Vanguard through and closed them again. Enemy horse came up behind the fugitives. He gave them a volley at long range, and they turned back toward the bridge without closing."
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
   "account": "Maj. von Reiter had no orders and kept his squadron at its post beside the northern wood, watching the open ground to the south."
  }
 ],
 "observations": [
  {
   "side": "blue",
   "unitId": "red-1",
   "by": "blue-1",
   "when": "start"
  },
  {
   "side": "blue",
   "unitId": "red-2",
   "by": "blue-3",
   "when": "start"
  },
  {
   "side": "red",
   "unitId": "blue-1",
   "by": "red-1",
   "when": "start"
  },
  {
   "side": "red",
   "unitId": "blue-2",
   "by": "red-1",
   "when": "start"
  },
  {
   "side": "red",
   "unitId": "blue-3",
   "by": "red-1",
   "when": "start"
  },
  {
   "side": "blue",
   "unitId": "red-2",
   "by": "blue-3",
   "when": "end"
  },
  {
   "side": "red",
   "unitId": "blue-3",
   "by": "red-2",
   "when": "end"
  }
 ],
 "summary": "Turn 2: the Blue squadron pursued the broken Vanguard up the high road. It took about 40 prisoners short of the wood line, then turned back under a long volley from the Red Line Battalion, which had formed across the road at y 700; it lost 8 men and holds the north end of the bridge (2050,1300). The Vanguard passed through the Line Battalion and rallied behind it at about y 460; it is active but weak, with 340 men and morale 34. Blue's two battalions still hold in line south of the bridge, and the Red hussars are idle beside the northern wood. The pursuit was ruled because the order arrived at minute 2 and the engine had left the squadron idle.",
 "precedents": [
  "Cavalry ordered to come back on meeting formed infantry breaks off its pursuit once it comes under the fire of a formed line, and does not charge it."
 ]
}
```

## Proposal C

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
   "fatigue": 12,
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
   "fatigue": 12,
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
   "y": 1330,
   "facingDeg": 0,
   "formation": "line",
   "strength": 200,
   "morale": 85,
   "fatigue": 7,
   "ammo": 100,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [
    {
     "orderId": "blue-b3-5",
     "result": "carried-out"
    }
   ],
   "account": "The Cavalry Squadron acted as the staff tables direct."
  },
  {
   "unitId": "red-1",
   "x": 2050,
   "y": 442,
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
   "x": 2150,
   "y": 700,
   "facingDeg": 180,
   "formation": "line",
   "strength": 650,
   "morale": 70,
   "fatigue": 17,
   "ammo": 100,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [
    {
     "orderId": "red-r2-5",
     "result": "carried-out"
    }
   ],
   "account": "The Line Battalion acted as the staff tables direct."
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
   "account": "The Hussar Squadron acted as the staff tables direct."
  }
 ],
 "observations": [
  {
   "side": "blue",
   "unitId": "red-1",
   "by": "blue-1",
   "when": "start"
  },
  {
   "side": "blue",
   "unitId": "red-2",
   "by": "blue-3",
   "when": "start"
  },
  {
   "side": "red",
   "unitId": "blue-1",
   "by": "red-1",
   "when": "start"
  },
  {
   "side": "red",
   "unitId": "blue-2",
   "by": "red-1",
   "when": "start"
  },
  {
   "side": "red",
   "unitId": "blue-3",
   "by": "red-1",
   "when": "start"
  },
  {
   "side": "blue",
   "unitId": "red-2",
   "by": "blue-3",
   "when": "end"
  }
 ],
 "summary": "The turn was resolved by the tables."
}
```
