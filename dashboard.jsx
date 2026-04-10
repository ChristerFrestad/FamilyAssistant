import { useState } from "react";

const DAYS = ["Mandag", "Tirsdag", "Onsdag", "Torsdag", "Fredag", "Lørdag", "Søndag"];
const TODAY_INDEX = new Date().getDay() === 0 ? 6 : new Date().getDay() - 1;

// Product database: maps ingredient names to store products with pack sizes and prices
const productDB = {
  "kyllingfilet": { productName: "Kyllingfilet", packSize: 500, unit: "g", estPrice: 89, shelfDays: 3 },
  "laksefilet": { productName: "Laksefilet", packSize: 400, unit: "g", estPrice: 159, shelfDays: 2 },
  "scampi": { productName: "Scampi fryst", packSize: 300, unit: "g", estPrice: 99, shelfDays: 180 },
  "biffstrimler": { productName: "Biffstrimler", packSize: 400, unit: "g", estPrice: 129, shelfDays: 3 },
  "kjøttdeig": { productName: "Kjøttdeig", packSize: 500, unit: "g", estPrice: 99, shelfDays: 2 },
  "nakkekoteletter": { productName: "Nakkekoteletter", packSize: 600, unit: "g", estPrice: 149, shelfDays: 4 },
  "svinekjøtt": { productName: "Svinekjøtt pulled", packSize: 800, unit: "g", estPrice: 129, shelfDays: 3 },
  "biff": { productName: "Biffstykker", packSize: 400, unit: "g", estPrice: 169, shelfDays: 3 },
  "hel kylling": { productName: "Hel kylling", packSize: 1800, unit: "g", estPrice: 149, shelfDays: 3 },
  "lam": { productName: "Lam kjøtt stew", packSize: 600, unit: "g", estPrice: 189, shelfDays: 3 },
  "oksekjøtt": { productName: "Oksekjøtt", packSize: 500, unit: "g", estPrice: 199, shelfDays: 3 },
  "ribs": { productName: "Ribs svin", packSize: 1200, unit: "g", estPrice: 179, shelfDays: 3 },
  "kjøttpølser": { productName: "Kjøttpølser", packSize: 400, unit: "g", estPrice: 69, shelfDays: 5 },
  "bacon": { productName: "Bacon", packSize: 200, unit: "g", estPrice: 59, shelfDays: 5 },
  "røkt laks": { productName: "Røkt laks", packSize: 150, unit: "g", estPrice: 79, shelfDays: 3 },
  "pepperoni": { productName: "Pepperoni", packSize: 100, unit: "g", estPrice: 49, shelfDays: 14 },

  "mozzarella": { productName: "Mozzarella Røros", packSize: 500, unit: "g", estPrice: 129, shelfDays: 7 },
  "cheddar": { productName: "Cheddar Røros", packSize: 400, unit: "g", estPrice: 119, shelfDays: 21 },
  "parmesan": { productName: "Parmesan Røros", packSize: 200, unit: "g", estPrice: 99, shelfDays: 21 },
  "ricotta": { productName: "Ricotta Røros", packSize: 500, unit: "g", estPrice: 99, shelfDays: 7 },
  "smør": { productName: "Røros smør", packSize: 250, unit: "g", estPrice: 79, shelfDays: 30 },
  "fløte": { productName: "Røros fløte 3dl", packSize: 300, unit: "ml", estPrice: 29, shelfDays: 7 },
  "rømme": { productName: "Røros rømme 3dl", packSize: 300, unit: "ml", estPrice: 25, shelfDays: 7 },
  "egg": { productName: "Egg (10stk)", packSize: 10, unit: "stk", estPrice: 39, shelfDays: 21 },
  "ost": { productName: "Ost blanding", packSize: 500, unit: "g", estPrice: 99, shelfDays: 14 },

  "paprika": { productName: "Paprika rød", packSize: 3, unit: "stk", estPrice: 29, shelfDays: 7 },
  "sukkererter": { productName: "Sukkererter", packSize: 300, unit: "g", estPrice: 19, shelfDays: 4 },
  "brokkolini": { productName: "Brokkolini", packSize: 300, unit: "g", estPrice: 35, shelfDays: 4 },
  "poteter": { productName: "Poteter", packSize: 2000, unit: "g", estPrice: 29, shelfDays: 14 },
  "søtpotet": { productName: "Søtpotet", packSize: 1000, unit: "g", estPrice: 35, shelfDays: 10 },
  "vårløk": { productName: "Vårløk", packSize: 200, unit: "g", estPrice: 15, shelfDays: 5 },
  "løk": { productName: "Løk", packSize: 1500, unit: "g", estPrice: 15, shelfDays: 21 },
  "hvitløk": { productName: "Hvitløk", packSize: 500, unit: "g", estPrice: 25, shelfDays: 21 },
  "ingefær": { productName: "Ingefær", packSize: 200, unit: "g", estPrice: 19, shelfDays: 14 },
  "sitron": { productName: "Sitron", packSize: 4, unit: "stk", estPrice: 15, shelfDays: 10 },
  "lime": { productName: "Lime", packSize: 3, unit: "stk", estPrice: 15, shelfDays: 10 },
  "isbergsalat": { productName: "Isbergsalat", packSize: 300, unit: "g", estPrice: 25, shelfDays: 4 },
  "tomat": { productName: "Tomat", packSize: 1000, unit: "g", estPrice: 35, shelfDays: 5 },
  "gulrot": { productName: "Gulrot", packSize: 1000, unit: "g", estPrice: 12, shelfDays: 14 },
  "sellerirot": { productName: "Sellerirot", packSize: 500, unit: "g", estPrice: 15, shelfDays: 14 },
  "basilikum": { productName: "Basilikum fersk", packSize: 25, unit: "g", estPrice: 12, shelfDays: 3 },
  "persille": { productName: "Persille fersk", packSize: 30, unit: "g", estPrice: 12, shelfDays: 4 },
  "dill": { productName: "Dill fersk", packSize: 30, unit: "g", estPrice: 12, shelfDays: 4 },
  "timian": { productName: "Timian fersk", packSize: 20, unit: "g", estPrice: 12, shelfDays: 7 },
  "estragon": { productName: "Estragon fersk", packSize: 20, unit: "g", estPrice: 12, shelfDays: 4 },
  "spinat": { productName: "Spinat fersk", packSize: 300, unit: "g", estPrice: 29, shelfDays: 3 },
  "kål": { productName: "Kål", packSize: 1000, unit: "g", estPrice: 12, shelfDays: 14 },
  "mais": { productName: "Mais fryst", packSize: 400, unit: "g", estPrice: 15, shelfDays: 180 },
  "agurk": { productName: "Agurk", packSize: 3, unit: "stk", estPrice: 15, shelfDays: 5 },
  "mango": { productName: "Mango", packSize: 2, unit: "stk", estPrice: 25, shelfDays: 5 },
  "avokado": { productName: "Avokado", packSize: 2, unit: "stk", estPrice: 35, shelfDays: 3 },
  "chili": { productName: "Chili rød", packSize: 3, unit: "stk", estPrice: 15, shelfDays: 7 },

  "jasminris": { productName: "Jasminris", packSize: 1000, unit: "g", estPrice: 35, shelfDays: 365 },
  "ris": { productName: "Basmati-ris", packSize: 1000, unit: "g", estPrice: 35, shelfDays: 365 },
  "spaghetti": { productName: "Spaghetti", packSize: 500, unit: "g", estPrice: 15, shelfDays: 365 },
  "pasta": { productName: "Pasta blanda", packSize: 500, unit: "g", estPrice: 15, shelfDays: 365 },
  "nudler": { productName: "Nudler asiatisk", packSize: 400, unit: "g", estPrice: 25, shelfDays: 365 },
  "lasagneplater": { productName: "Lasagneplater", packSize: 500, unit: "g", estPrice: 19, shelfDays: 365 },

  "red curry paste": { productName: "Red curry paste", packSize: 400, unit: "g", estPrice: 39, shelfDays: 180 },
  "kokosmelk": { productName: "Kokosmelk boks", packSize: 400, unit: "ml", estPrice: 22, shelfDays: 365 },
  "soyasaus": { productName: "Soyasaus", packSize: 300, unit: "ml", estPrice: 35, shelfDays: 365 },
  "san marzano-tomater": { productName: "San Marzano-tomater", packSize: 400, unit: "g", estPrice: 19, shelfDays: 365 },
  "bbq-saus": { productName: "BBQ-saus", packSize: 400, unit: "ml", estPrice: 45, shelfDays: 180 },
  "sriracha": { productName: "Sriracha-saus", packSize: 200, unit: "ml", estPrice: 35, shelfDays: 365 },
  "majones": { productName: "Majones", packSize: 400, unit: "g", estPrice: 25, shelfDays: 180 },
  "aioli": { productName: "Aioli", packSize: 300, unit: "g", estPrice: 35, shelfDays: 180 },
  "pesto": { productName: "Pesto grønn", packSize: 190, unit: "g", estPrice: 39, shelfDays: 180 },
  "olivenolje": { productName: "Olivenolje", packSize: 500, unit: "ml", estPrice: 89, shelfDays: 365 },
  "honning": { productName: "Honning", packSize: 400, unit: "g", estPrice: 59, shelfDays: 365 },
  "brunt sukker": { productName: "Brunt sukker", packSize: 1000, unit: "g", estPrice: 29, shelfDays: 365 },

  "briochebrød": { productName: "Briochebrød", packSize: 4, unit: "stk", estPrice: 39, shelfDays: 4 },
  "pizzadeig": { productName: "Pizzadeig fersk", packSize: 500, unit: "g", estPrice: 19, shelfDays: 3 },
  "brød": { productName: "Brød", packSize: 500, unit: "g", estPrice: 29, shelfDays: 3 },
  "pitabrød": { productName: "Pitabrød", packSize: 300, unit: "g", estPrice: 19, shelfDays: 4 },
  "tortilla": { productName: "Tortilla hvete", packSize: 300, unit: "g", estPrice: 19, shelfDays: 7 },
  "tacoskjell": { productName: "Tacoskjell", packSize: 200, unit: "g", estPrice: 19, shelfDays: 365 },

  "sylteagurk": { productName: "Sylteagurk", packSize: 370, unit: "g", estPrice: 15, shelfDays: 180 },
  "mel": { productName: "Hvetemel", packSize: 1000, unit: "g", estPrice: 19, shelfDays: 365 },
  "gjær": { productName: "Gjær", packSize: 50, unit: "g", estPrice: 35, shelfDays: 14 },
  "cashewnøtter": { productName: "Cashewnøtter ristede", packSize: 200, unit: "g", estPrice: 79, shelfDays: 180 },
  "nachos": { productName: "Nachos chips", packSize: 300, unit: "g", estPrice: 29, shelfDays: 180 },
  "rødvin": { productName: "Rødvin", packSize: 750, unit: "ml", estPrice: 99, shelfDays: 365 },
};

// Main recipe database with exact quantities
const mealPlanInit = [
  {
    day: "Mandag",
    meal: "Kylling red curry med jasminris",
    category: "rask",
    time: "25 min",
    source: "godt.no",
    url: "https://www.godt.no/oppskrifter/gryte/8421/varmende-red-curry-paa-30-minutter",
    ingredients: [
      { name: "kyllingfilet", qty: 400, unit: "g" },
      { name: "red curry paste", qty: 2, unit: "ss" },
      { name: "kokosmelk", qty: 400, unit: "ml" },
      { name: "paprika", qty: 1, unit: "stk" },
      { name: "sukkererter", qty: 200, unit: "g" },
      { name: "jasminris", qty: 300, unit: "g" },
      { name: "lime", qty: 0.5, unit: "stk" },
    ],
  },
  {
    day: "Tirsdag",
    meal: "Laks i airfryer med potetbåter og brokkolini",
    category: "rask",
    time: "20 min",
    source: "matprat.no",
    url: "https://www.matprat.no/oppskrifter/rask/laks-i-airfryer/",
    ingredients: [
      { name: "laksefilet", qty: 400, unit: "g" },
      { name: "poteter", qty: 500, unit: "g" },
      { name: "brokkolini", qty: 300, unit: "g" },
      { name: "sitron", qty: 0.5, unit: "stk" },
      { name: "olivenolje", qty: 2, unit: "ss" },
    ],
  },
  {
    day: "Onsdag",
    meal: "Pasta med scampi, hvitløk og chili",
    category: "rask",
    time: "20 min",
    source: "matprat.no",
    url: "https://www.matprat.no/oppskrifter/",
    ingredients: [
      { name: "scampi", qty: 300, unit: "g" },
      { name: "spaghetti", qty: 400, unit: "g" },
      { name: "hvitløk", qty: 3, unit: "fedd" },
      { name: "chili", qty: 1, unit: "stk" },
      { name: "persille", qty: 15, unit: "g" },
      { name: "sitron", qty: 0.5, unit: "stk" },
      { name: "smør", qty: 50, unit: "g" },
    ],
  },
  {
    day: "Torsdag",
    meal: "Mongolian beef med ris og wokede grønnsaker",
    category: "rask",
    time: "30 min",
    source: "godt.no",
    url: "https://www.godt.no/oppskrifter/",
    ingredients: [
      { name: "biffstrimler", qty: 400, unit: "g" },
      { name: "vårløk", qty: 150, unit: "g" },
      { name: "soyasaus", qty: 3, unit: "ss" },
      { name: "brunt sukker", qty: 2, unit: "ss" },
      { name: "ingefær", qty: 1, unit: "ts" },
      { name: "hvitløk", qty: 2, unit: "fedd" },
      { name: "ris", qty: 300, unit: "g" },
    ],
  },
  {
    day: "Fredag",
    meal: "Smashburger i brioche med løkringer og coleslaw",
    category: "comfort",
    time: "45 min",
    source: "matprat.no",
    url: "https://www.matprat.no/oppskrifter/kos/smash-burger/",
    ingredients: [
      { name: "kjøttdeig", qty: 400, unit: "g" },
      { name: "briochebrød", qty: 2, unit: "stk" },
      { name: "cheddar", qty: 100, unit: "g" },
      { name: "løk", qty: 1, unit: "stk" },
      { name: "sylteagurk", qty: 50, unit: "g" },
      { name: "isbergsalat", qty: 150, unit: "g" },
      { name: "tomat", qty: 1, unit: "stk" },
    ],
  },
  {
    day: "Lørdag",
    meal: "Hjemmelaget pizza på pizzastein",
    category: "helg",
    time: "1,5 t",
    source: "matprat.no",
    url: "https://www.matprat.no/oppskrifter/",
    ingredients: [
      { name: "pizzadeig", qty: 500, unit: "g" },
      { name: "san marzano-tomater", qty: 400, unit: "g" },
      { name: "mozzarella", qty: 250, unit: "g" },
      { name: "pepperoni", qty: 80, unit: "g" },
      { name: "basilikum", qty: 10, unit: "g" },
      { name: "olivenolje", qty: 3, unit: "ss" },
    ],
  },
  {
    day: "Søndag",
    meal: "Langtidsstekt nakkekoteletter med rotgrønnsaker",
    category: "helg",
    time: "3 t",
    source: "matprat.no",
    url: "https://www.matprat.no/oppskrifter/",
    ingredients: [
      { name: "nakkekoteletter", qty: 600, unit: "g" },
      { name: "gulrot", qty: 300, unit: "g" },
      { name: "sellerirot", qty: 200, unit: "g" },
      { name: "løk", qty: 1, unit: "stk" },
      { name: "timian", qty: 5, unit: "g" },
      { name: "hvitløk", qty: 2, unit: "fedd" },
    ],
  },
];

// Alternative suggestions with exact quantities
const altSuggestions = {
  "Mandag": [
    {
      meal: "Wok med kylling, cashewnøtter og grønnsaker",
      time: "20 min",
      category: "rask",
      reason: "Bruker kylling og grønnsaker du har hjemme",
      source: "matprat.no",
      url: "https://www.matprat.no/oppskrifter/",
      ingredients: [
        { name: "kyllingfilet", qty: 400, unit: "g" },
        { name: "cashewnøtter", qty: 100, unit: "g" },
        { name: "paprika", qty: 1, unit: "stk" },
        { name: "soyasaus", qty: 2, unit: "ss" },
        { name: "ris", qty: 300, unit: "g" },
      ],
    },
    {
      meal: "Enkel kyllingsuppe med nudler",
      time: "25 min",
      category: "rask",
      reason: "Kylling + grønnsaker fra kjøleskapet",
      source: "godt.no",
      url: "https://www.godt.no/oppskrifter/",
      ingredients: [
        { name: "kyllingfilet", qty: 300, unit: "g" },
        { name: "nudler", qty: 150, unit: "g" },
        { name: "gulrot", qty: 150, unit: "g" },
        { name: "ingefær", qty: 1, unit: "ts" },
      ],
    },
    {
      meal: "Stekt ris med egg og grønnsaker",
      time: "15 min",
      category: "rask",
      reason: "Ris, egg og rester — nesten ingen ny handling",
      source: "matprat.no",
      url: "https://www.matprat.no/oppskrifter/",
      ingredients: [
        { name: "ris", qty: 300, unit: "g" },
        { name: "egg", qty: 2, unit: "stk" },
        { name: "vårløk", qty: 100, unit: "g" },
        { name: "soyasaus", qty: 1, unit: "ss" },
      ],
    },
    {
      meal: "Kylling i airfryer med søtpotet",
      time: "25 min",
      category: "rask",
      reason: "Airfryer-rett, minimalt med oppvask",
      source: "matprat.no",
      url: "https://www.matprat.no/oppskrifter/rask/kyllingfilet-i-airfryer/",
      ingredients: [
        { name: "kyllingfilet", qty: 400, unit: "g" },
        { name: "søtpotet", qty: 500, unit: "g" },
        { name: "olivenolje", qty: 2, unit: "ss" },
      ],
    },
    {
      meal: "Dumplings i bambusdamper med dippsaus",
      time: "30 min",
      category: "rask",
      reason: "Bruker bambusdamperen, morsomt å lage",
      source: "godt.no",
      url: "https://www.godt.no/oppskrifter/",
      ingredients: [
        { name: "kjøttdeig", qty: 250, unit: "g" },
        { name: "vårløk", qty: 100, unit: "g" },
        { name: "ingefær", qty: 1, unit: "ts" },
        { name: "soyasaus", qty: 2, unit: "ss" },
      ],
    },
  ],
  "Tirsdag": [
    {
      meal: "Lakseburgere med avokado og srirachamayo",
      time: "25 min",
      category: "rask",
      reason: "Bruker laksen, bare annen form",
      source: "godt.no",
      url: "https://www.godt.no/oppskrifter/",
      ingredients: [
        { name: "laksefilet", qty: 400, unit: "g" },
        { name: "avokado", qty: 1, unit: "stk" },
        { name: "sriracha", qty: 1, unit: "ss" },
        { name: "majones", qty: 100, unit: "g" },
      ],
    },
    {
      meal: "Bakt laks med honning og soya i airfryer",
      time: "20 min",
      category: "rask",
      reason: "Laks + airfryer, raskere enn ovn",
      source: "matprat.no",
      url: "https://www.matprat.no/oppskrifter/rask/laks-i-airfryer/",
      ingredients: [
        { name: "laksefilet", qty: 400, unit: "g" },
        { name: "honning", qty: 2, unit: "ss" },
        { name: "soyasaus", qty: 2, unit: "ss" },
      ],
    },
    {
      meal: "Pasta med røkt laks og fløtesaus",
      time: "20 min",
      category: "rask",
      reason: "Røros-fløte i sausen",
      source: "matprat.no",
      url: "https://www.matprat.no/oppskrifter/",
      ingredients: [
        { name: "røkt laks", qty: 150, unit: "g" },
        { name: "pasta", qty: 400, unit: "g" },
        { name: "fløte", qty: 150, unit: "ml" },
        { name: "dill", qty: 10, unit: "g" },
      ],
    },
    {
      meal: "Fish tacos med laks og mangosalsa",
      time: "25 min",
      category: "rask",
      reason: "Laks i ny innpakning",
      source: "godt.no",
      url: "https://www.godt.no/oppskrifter/",
      ingredients: [
        { name: "laksefilet", qty: 300, unit: "g" },
        { name: "tortilla", qty: 150, unit: "g" },
        { name: "mango", qty: 1, unit: "stk" },
        { name: "lime", qty: 1, unit: "stk" },
      ],
    },
    {
      meal: "Kylling red curry med jasminris",
      time: "25 min",
      category: "rask",
      reason: "Flytt mandagens rett hit i stedet",
      source: "godt.no",
      url: "https://www.godt.no/oppskrifter/gryte/8421/varmende-red-curry-paa-30-minutter",
      ingredients: [
        { name: "kyllingfilet", qty: 400, unit: "g" },
        { name: "red curry paste", qty: 2, unit: "ss" },
        { name: "kokosmelk", qty: 400, unit: "ml" },
        { name: "jasminris", qty: 300, unit: "g" },
      ],
    },
  ],
  "Onsdag": [
    {
      meal: "Aglio e olio (pasta med hvitløk og chili)",
      time: "15 min",
      category: "rask",
      reason: "Pasta, hvitløk og chili — ingen ny handling",
      source: "godt.no",
      url: "https://www.godt.no/oppskrifter/",
      ingredients: [
        { name: "spaghetti", qty: 400, unit: "g" },
        { name: "hvitløk", qty: 4, unit: "fedd" },
        { name: "chili", qty: 1, unit: "stk" },
        { name: "olivenolje", qty: 4, unit: "ss" },
      ],
    },
    {
      meal: "Carbonara med bacon og egg",
      time: "20 min",
      category: "rask",
      reason: "Pasta + egg + ost, mettende",
      source: "matprat.no",
      url: "https://www.matprat.no/oppskrifter/",
      ingredients: [
        { name: "spaghetti", qty: 400, unit: "g" },
        { name: "bacon", qty: 150, unit: "g" },
        { name: "egg", qty: 2, unit: "stk" },
        { name: "parmesan", qty: 80, unit: "g" },
      ],
    },
    {
      meal: "Pastasalat med kylling og pesto",
      time: "20 min",
      category: "rask",
      reason: "Bruk restekylling fra mandag",
      source: "matprat.no",
      url: "https://www.matprat.no/oppskrifter/",
      ingredients: [
        { name: "pasta", qty: 300, unit: "g" },
        { name: "kyllingfilet", qty: 300, unit: "g" },
        { name: "pesto", qty: 100, unit: "g" },
        { name: "tomat", qty: 200, unit: "g" },
      ],
    },
    {
      meal: "Nudler med kjøttdeig, ingefær og chili",
      time: "20 min",
      category: "rask",
      reason: "Ingefær og chili har du",
      source: "godt.no",
      url: "https://www.godt.no/oppskrifter/pasta/nudler/9042/nudler-med-smaksrik-kjoettdeig",
      ingredients: [
        { name: "nudler", qty: 300, unit: "g" },
        { name: "kjøttdeig", qty: 300, unit: "g" },
        { name: "ingefær", qty: 1, unit: "ts" },
        { name: "chili", qty: 1, unit: "stk" },
      ],
    },
    {
      meal: "Toast i airfryer med scampi og aioli",
      time: "15 min",
      category: "rask",
      reason: "Scampi fra planen + airfryer",
      source: "matprat.no",
      url: "https://www.matprat.no/oppskrifter/rask/toast-i-airfryer/",
      ingredients: [
        { name: "brød", qty: 200, unit: "g" },
        { name: "scampi", qty: 250, unit: "g" },
        { name: "aioli", qty: 100, unit: "g" },
      ],
    },
  ],
  "Torsdag": [
    {
      meal: "Biff i airfryer med potetbåter",
      time: "20 min",
      category: "rask",
      reason: "Biffstrimler du har, airfryer gjør resten",
      source: "matprat.no",
      url: "https://www.matprat.no/oppskrifter/rask/biff-i-airfryer/",
      ingredients: [
        { name: "biffstrimler", qty: 400, unit: "g" },
        { name: "poteter", qty: 500, unit: "g" },
        { name: "olivenolje", qty: 2, unit: "ss" },
      ],
    },
    {
      meal: "Bibimbap med biffstrimler og ris",
      time: "30 min",
      category: "rask",
      reason: "Biff + ris, asiatisk vri",
      source: "godt.no",
      url: "https://www.godt.no/oppskrifter/",
      ingredients: [
        { name: "biffstrimler", qty: 400, unit: "g" },
        { name: "ris", qty: 300, unit: "g" },
        { name: "egg", qty: 1, unit: "stk" },
        { name: "gulrot", qty: 150, unit: "g" },
        { name: "soyasaus", qty: 2, unit: "ss" },
      ],
    },
    {
      meal: "Teriyaki-kylling med ris",
      time: "25 min",
      category: "rask",
      reason: "Soyasaus har du",
      source: "matprat.no",
      url: "https://www.matprat.no/oppskrifter/",
      ingredients: [
        { name: "kyllingfilet", qty: 400, unit: "g" },
        { name: "ris", qty: 300, unit: "g" },
        { name: "soyasaus", qty: 3, unit: "ss" },
        { name: "honning", qty: 2, unit: "ss" },
      ],
    },
    {
      meal: "Hjemmelagde dumplings med svinekjøtt",
      time: "40 min",
      category: "rask",
      reason: "Bambusdamper + kjøttdeig",
      source: "godt.no",
      url: "https://www.godt.no/oppskrifter/",
      ingredients: [
        { name: "kjøttdeig", qty: 300, unit: "g" },
        { name: "vårløk", qty: 100, unit: "g" },
        { name: "ingefær", qty: 1, unit: "ts" },
        { name: "soyasaus", qty: 2, unit: "ss" },
      ],
    },
    {
      meal: "Stekte nudler med biff og grønnsaker",
      time: "20 min",
      category: "rask",
      reason: "Biffstrimler + wokgrønnsaker",
      source: "matprat.no",
      url: "https://www.matprat.no/oppskrifter/",
      ingredients: [
        { name: "biffstrimler", qty: 400, unit: "g" },
        { name: "nudler", qty: 300, unit: "g" },
        { name: "paprika", qty: 1, unit: "stk" },
        { name: "soyasaus", qty: 2, unit: "ss" },
      ],
    },
  ],
  "Fredag": [
    {
      meal: "Smash burger i pitabrød med tzatziki",
      time: "30 min",
      category: "comfort",
      reason: "Kjøttdeig du har, pita i stedet",
      source: "matprat.no",
      url: "https://www.matprat.no/oppskrifter/kos/smash-burger/",
      ingredients: [
        { name: "kjøttdeig", qty: 400, unit: "g" },
        { name: "pitabrød", qty: 150, unit: "g" },
        { name: "agurk", qty: 1, unit: "stk" },
        { name: "rømme", qty: 150, unit: "ml" },
      ],
    },
    {
      meal: "Kebabretter med hjemmelaget dressing",
      time: "40 min",
      category: "comfort",
      reason: "Kjøttdeig + salat + dressing",
      source: "godt.no",
      url: "https://www.godt.no/oppskrifter/",
      ingredients: [
        { name: "kjøttdeig", qty: 400, unit: "g" },
        { name: "isbergsalat", qty: 200, unit: "g" },
        { name: "tomat", qty: 2, unit: "stk" },
        { name: "rømme", qty: 150, unit: "ml" },
      ],
    },
    {
      meal: "Tacos med kjøttdeig og toppings",
      time: "35 min",
      category: "comfort",
      reason: "Kjøttdeig har du allerede",
      source: "matprat.no",
      url: "https://www.matprat.no/oppskrifter/",
      ingredients: [
        { name: "kjøttdeig", qty: 400, unit: "g" },
        { name: "tacoskjell", qty: 150, unit: "g" },
        { name: "rømme", qty: 100, unit: "ml" },
        { name: "tomat", qty: 1, unit: "stk" },
        { name: "ost", qty: 80, unit: "g" },
      ],
    },
    {
      meal: "Nachos grande med ost og jalapeños",
      time: "25 min",
      category: "comfort",
      reason: "Cheddar og kjøttdeig fra planen",
      source: "godt.no",
      url: "https://www.godt.no/oppskrifter/",
      ingredients: [
        { name: "nachos", qty: 200, unit: "g" },
        { name: "kjøttdeig", qty: 300, unit: "g" },
        { name: "cheddar", qty: 100, unit: "g" },
        { name: "rømme", qty: 150, unit: "ml" },
      ],
    },
    {
      meal: "Grove kjøttpølser med løkompott og potetmos",
      time: "35 min",
      category: "comfort",
      reason: "Christers favoritt, poteter og løk har du",
      source: "matprat.no",
      url: "https://www.matprat.no/oppskrifter/",
      ingredients: [
        { name: "kjøttpølser", qty: 400, unit: "g" },
        { name: "løk", qty: 2, unit: "stk" },
        { name: "poteter", qty: 500, unit: "g" },
        { name: "smør", qty: 50, unit: "g" },
      ],
    },
  ],
  "Lørdag": [
    {
      meal: "Lasagne med ricotta og spinat",
      time: "1,5 t",
      category: "helg",
      reason: "Comfort-klassiker, mozzarella fra planen",
      source: "godt.no",
      url: "https://www.godt.no/oppskrifter/",
      ingredients: [
        { name: "lasagneplater", qty: 500, unit: "g" },
        { name: "ricotta", qty: 400, unit: "g" },
        { name: "spinat", qty: 300, unit: "g" },
        { name: "mozzarella", qty: 200, unit: "g" },
      ],
    },
    {
      meal: "Marticcia (familieretten!)",
      time: "1 t",
      category: "helg",
      reason: "Familiens egen rett — alltid en vinner",
      source: "Eget",
      url: "",
      ingredients: [
        { name: "kjøttdeig", qty: 500, unit: "g" },
        { name: "tomat", qty: 500, unit: "g" },
        { name: "pasta", qty: 400, unit: "g" },
        { name: "ost", qty: 100, unit: "g" },
      ],
    },
    {
      meal: "Grillburger-kveld med onion rings",
      time: "1,5 t",
      category: "helg",
      reason: "Gassgrill + briochebrød + løk",
      source: "matprat.no",
      url: "https://www.matprat.no/oppskrifter/kos/smash-burger/",
      ingredients: [
        { name: "kjøttdeig", qty: 400, unit: "g" },
        { name: "briochebrød", qty: 2, unit: "stk" },
        { name: "løk", qty: 2, unit: "stk" },
        { name: "cheddar", qty: 100, unit: "g" },
      ],
    },
    {
      meal: "Hjemmelaget ramen med svin og egg",
      time: "2 t",
      category: "helg",
      reason: "Helgeprosjekt, ingefær og soyasaus fra skapet",
      source: "godt.no",
      url: "https://www.godt.no/oppskrifter/",
      ingredients: [
        { name: "svinekjøtt", qty: 500, unit: "g" },
        { name: "nudler", qty: 400, unit: "g" },
        { name: "egg", qty: 2, unit: "stk" },
        { name: "ingefær", qty: 2, unit: "ts" },
        { name: "soyasaus", qty: 3, unit: "ss" },
      ],
    },
    {
      meal: "Grillet biff med bearnaise og ovnsbakte poteter",
      time: "1 t",
      category: "helg",
      reason: "Gassgrill + Røros-fløte til saus",
      source: "matprat.no",
      url: "https://www.matprat.no/oppskrifter/",
      ingredients: [
        { name: "biff", qty: 600, unit: "g" },
        { name: "poteter", qty: 500, unit: "g" },
        { name: "fløte", qty: 200, unit: "ml" },
        { name: "estragon", qty: 5, unit: "g" },
      ],
    },
  ],
  "Søndag": [
    {
      meal: "Pulled pork i støpejernsgryte med coleslaw",
      time: "4 t",
      category: "helg",
      reason: "Langtidskokt i støpejern, perfekt søndag",
      source: "godt.no",
      url: "https://www.godt.no/oppskrifter/",
      ingredients: [
        { name: "svinekjøtt", qty: 800, unit: "g" },
        { name: "bbq-saus", qty: 200, unit: "ml" },
        { name: "kål", qty: 500, unit: "g" },
        { name: "gulrot", qty: 200, unit: "g" },
      ],
    },
    {
      meal: "Helstekt kylling med rotgrønnsaker",
      time: "2 t",
      category: "helg",
      reason: "Gulrot og selleri fra planen",
      source: "matprat.no",
      url: "https://www.matprat.no/oppskrifter/",
      ingredients: [
        { name: "hel kylling", qty: 1800, unit: "g" },
        { name: "gulrot", qty: 400, unit: "g" },
        { name: "sellerirot", qty: 300, unit: "g" },
        { name: "løk", qty: 2, unit: "stk" },
      ],
    },
    {
      meal: "Lam i støpejernsgryte med timian",
      time: "3,5 t",
      category: "helg",
      reason: "Støpejernsgryta gjør jobben",
      source: "matprat.no",
      url: "https://www.matprat.no/oppskrifter/",
      ingredients: [
        { name: "lam", qty: 600, unit: "g" },
        { name: "timian", qty: 10, unit: "g" },
        { name: "gulrot", qty: 300, unit: "g" },
        { name: "løk", qty: 1, unit: "stk" },
      ],
    },
    {
      meal: "Boeuf bourguignon med potetmos",
      time: "3 t",
      category: "helg",
      reason: "Klassisk søndagsmiddag",
      source: "godt.no",
      url: "https://www.godt.no/oppskrifter/",
      ingredients: [
        { name: "oksekjøtt", qty: 600, unit: "g" },
        { name: "rødvin", qty: 250, unit: "ml" },
        { name: "gulrot", qty: 300, unit: "g" },
        { name: "løk", qty: 1, unit: "stk" },
        { name: "poteter", qty: 500, unit: "g" },
      ],
    },
    {
      meal: "Ribs på gassgrill med BBQ-saus og mais",
      time: "3 t",
      category: "helg",
      reason: "Gassgrill + langtid = mørt og godt",
      source: "matprat.no",
      url: "https://www.matprat.no/oppskrifter/",
      ingredients: [
        { name: "ribs", qty: 1200, unit: "g" },
        { name: "bbq-saus", qty: 200, unit: "ml" },
        { name: "mais", qty: 200, unit: "g" },
        { name: "poteter", qty: 400, unit: "g" },
      ],
    },
  ],
};

// Kategorisering av ingredienser
const ingredientCategory = {
  "kyllingfilet": "Kjøtt & fisk", "laksefilet": "Kjøtt & fisk", "scampi": "Kjøtt & fisk",
  "biffstrimler": "Kjøtt & fisk", "kjøttdeig": "Kjøtt & fisk", "nakkekoteletter": "Kjøtt & fisk",
  "pepperoni": "Kjøtt & fisk", "bacon": "Kjøtt & fisk", "svinekjøtt": "Kjøtt & fisk",
  "kjøttpølser": "Kjøtt & fisk", "røkt laks": "Kjøtt & fisk", "lam": "Kjøtt & fisk",
  "oksekjøtt": "Kjøtt & fisk", "ribs": "Kjøtt & fisk", "biff": "Kjøtt & fisk",
  "hel kylling": "Kjøtt & fisk",
  "mozzarella": "Meieri (Røros!)", "cheddar": "Meieri (Røros!)", "smør": "Meieri (Røros!)",
  "fløte": "Meieri (Røros!)", "rømme": "Meieri (Røros!)", "egg": "Meieri (Røros!)",
  "parmesan": "Meieri (Røros!)", "ricotta": "Meieri (Røros!)", "ost": "Meieri (Røros!)",
  "paprika": "Frukt & grønt", "sukkererter": "Frukt & grønt", "brokkolini": "Frukt & grønt",
  "poteter": "Frukt & grønt", "vårløk": "Frukt & grønt", "løk": "Frukt & grønt",
  "hvitløk": "Frukt & grønt", "ingefær": "Frukt & grønt", "sitron": "Frukt & grønt",
  "lime": "Frukt & grønt", "isbergsalat": "Frukt & grønt", "tomat": "Frukt & grønt",
  "gulrot": "Frukt & grønt", "sellerirot": "Frukt & grønt", "basilikum": "Frukt & grønt",
  "persille": "Frukt & grønt", "chili": "Frukt & grønt", "timian": "Frukt & grønt",
  "olivenolje": "Tørrvarer & annet", "kraft": "Frukt & grønt",
  "jasminris": "Tørrvarer & annet", "ris": "Tørrvarer & annet", "spaghetti": "Tørrvarer & annet",
  "pasta": "Tørrvarer & annet", "nudler": "Tørrvarer & annet", "red curry paste": "Tørrvarer & annet",
  "kokosmelk": "Tørrvarer & annet", "soyasaus": "Tørrvarer & annet",
  "san marzano-tomater": "Tørrvarer & annet", "briochebrød": "Frukt & grønt",
  "pizzadeig": "Frukt & grønt", "brunt sukker": "Tørrvarer & annet",
  "brød": "Frukt & grønt", "pitabrød": "Frukt & grønt", "tacoskjell": "Tørrvarer & annet",
  "nachos": "Tørrvarer & annet", "cashewnøtter": "Tørrvarer & annet", "honning": "Tørrvarer & annet",
  "sriracha": "Tørrvarer & annet", "majones": "Tørrvarer & annet", "aioli": "Tørrvarer & annet",
  "pesto": "Tørrvarer & annet", "bbq-saus": "Tørrvarer & annet", "rødvin": "Tørrvarer & annet",
  "lasagneplater": "Tørrvarer & annet", "sylteagurk": "Frukt & grønt", "mel": "Tørrvarer & annet",
  "gjær": "Tørrvarer & annet", "tortilla": "Frukt & grønt", "dill": "Frukt & grønt",
  "estragon": "Frukt & grønt", "spinat": "Frukt & grønt", "kål": "Frukt & grønt",
  "mais": "Frukt & grønt", "agurk": "Frukt & grønt", "mango": "Frukt & grønt", "avokado": "Frukt & grønt",
  "søtpotet": "Frukt & grønt",
};

// Faste husholdningsvarer
const alwaysOnList = [
  { name: "Bleier (snart!)", category: "Husholdning" },
  { name: "Toalettpapir", category: "Husholdning" },
  { name: "Våtservietter barn", category: "Husholdning" },
  { name: "Røros helmelk 1L", category: "Meieri (Røros!)" },
];

// Lag smart handleliste basert på ingredienser
function buildSmartShoppingList(meals, knowledgeBase) {
  const seen = new Map();

  for (const meal of meals) {
    for (const ing of (meal.ingredients || [])) {
      const key = ing.name.toLowerCase();
      if (!seen.has(key)) {
        seen.set(key, { ingredients: [], meals: [] });
      }
      const entry = seen.get(key);
      entry.ingredients.push(ing);
      entry.meals.push({ mealName: meal.meal, qty: ing.qty, unit: ing.unit });
    }
  }

  const catMap = {};
  for (const [ingName, data] of seen) {
    const totalQty = data.ingredients.reduce((s, i) => s + (i.qty || 0), 0);
    const unit = data.ingredients[0]?.unit || "";
    const cat = ingredientCategory[ingName] || "Tørrvarer & annet";

    const product = productDB[ingName];
    let needToBuy = 0;
    if (product) {
      needToBuy = Math.ceil(totalQty / product.packSize);
    }

    const kb = knowledgeBase[ingName] || {};
    const hasHome = kb.estimatedRemaining || 0;
    const decrement = Math.max(0, Math.min(totalQty, hasHome));
    const stillNeed = Math.max(0, totalQty - decrement);

    if (stillNeed > 0 || !product) {
      if (!catMap[cat]) catMap[cat] = [];
      catMap[cat].push({
        name: ingName.charAt(0).toUpperCase() + ingName.slice(1),
        qty: stillNeed,
        unit,
        totalNeeded: totalQty,
        product,
        packCount: product ? Math.ceil(stillNeed / product.packSize) : 0,
        hasHome,
        decrement,
      });
    }
  }

  for (const item of alwaysOnList) {
    if (!catMap[item.category]) catMap[item.category] = [];
    catMap[item.category].push({ name: item.name, category: item.category, noProduct: true });
  }

  const order = ["Kjøtt & fisk", "Meieri (Røros!)", "Frukt & grønt", "Tørrvarer & annet", "Husholdning"];
  return order.filter(c => catMap[c]).map(c => ({ category: c, items: catMap[c] }));
}

const knowledgeBaseInit = {};

const choresInit = [
  { task: "Støvsuge hus + hagestue", frequency: "Ukentlig", day: "Mandag", icon: "🧹" },
  { task: "Vaske det store badet", frequency: "Ukentlig", day: "Tirsdag", icon: "🚿" },
  { task: "Vaske det lille badet", frequency: "Ukentlig", day: "Tirsdag", icon: "🪥" },
  { task: "Rydde huset inne", frequency: "Ukentlig", day: "Onsdag", icon: "🏠" },
  { task: "Rydde hagestuen", frequency: "Ukentlig", day: "Onsdag", icon: "🌿" },
  { task: "Ta ut søpla", frequency: "Ukentlig", day: "Torsdag", icon: "🗑️" },
  { task: "Vaske tøy", frequency: "Etter behov", day: "Fredag", icon: "👕" },
  { task: "Skifte sengetøy", frequency: "Hver 14. dag", day: "Fredag", icon: "🛏️", biweekly: true },
  { task: "Tørke støv", frequency: "Hver 14. dag", day: "Mandag", icon: "✨", biweekly: true },
  { task: "Rydde ute terrasse–garasje", frequency: "Hver 14. dag", day: "Fredag", icon: "🏡", biweekly: true },
  { task: "Pante flasker", frequency: "Hver 14. dag", day: "Torsdag", icon: "♻️", biweekly: true },
  { task: "Rydde kjøkkenet", frequency: "Etter behov", day: "—", icon: "🍳" },
  { task: "Rydde i kjøleskapet", frequency: "Etter behov", day: "—", icon: "❄️" },
];

const categoryColors = { rask: "#10b981", comfort: "#f59e0b", helg: "#8b5cf6" };
const categoryLabels = { rask: "Rask hverdagsmiddag", comfort: "Comfort food", helg: "Helgemiddag" };

function TabBar({ active, setActive }) {
  const tabs = [
    { id: "today", label: "I dag", icon: "☀️" },
    { id: "meals", label: "Ukemeny", icon: "🍽️" },
    { id: "shopping", label: "Handletur", icon: "🛒" },
    { id: "chores", label: "Husarbeid", icon: "✅" },
  ];
  return (
    <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, display: "flex", background: "#fff", borderTop: "1px solid #e5e7eb", zIndex: 50, paddingBottom: "env(safe-area-inset-bottom)" }}>
      {tabs.map(t => (
        <button key={t.id} onClick={() => setActive(t.id)} style={{ flex: 1, padding: "10px 0 8px", display: "flex", flexDirection: "column", alignItems: "center", gap: 2, background: "none", border: "none", color: active === t.id ? "#7c3aed" : "#9ca3af", fontWeight: active === t.id ? 700 : 400, fontSize: 11, cursor: "pointer" }}>
          <span style={{ fontSize: 20 }}>{t.icon}</span>{t.label}
        </button>
      ))}
    </div>
  );
}

function TodayView({ meals, choresData }) {
  const today = DAYS[TODAY_INDEX] || "Mandag";
  const todayMeal = meals.find(m => m.day === today) || meals[0];
  const todayChores = choresData.filter(c => c.day === today);
  const [doneChores, setDoneChores] = useState({});

  return (
    <div style={{ padding: "20px 16px 100px" }}>
      <div style={{ marginBottom: 24 }}>
        <p style={{ color: "#6b7280", fontSize: 14, margin: 0 }}>Hei, Frestad-familien</p>
        <h1 style={{ fontSize: 26, fontWeight: 800, margin: "4px 0 0", color: "#111827" }}>{today}</h1>
      </div>
      <div style={{ background: "linear-gradient(135deg, #7c3aed 0%, #a78bfa 100%)", borderRadius: 16, padding: 20, color: "#fff", marginBottom: 20 }}>
        <p style={{ fontSize: 12, opacity: 0.8, margin: 0, textTransform: "uppercase", letterSpacing: 1 }}>Dagens middag</p>
        <h2 style={{ fontSize: 20, fontWeight: 700, margin: "8px 0" }}>{todayMeal.meal}</h2>
        <div style={{ display: "flex", gap: 12, fontSize: 13, opacity: 0.9 }}>
          <span>⏱ {todayMeal.time}</span>
          <span style={{ background: "rgba(255,255,255,0.2)", borderRadius: 99, padding: "2px 10px" }}>{categoryLabels[todayMeal.category]}</span>
        </div>
        {todayMeal.url ? (
          <a href={todayMeal.url} target="_blank" rel="noopener" style={{ display: "inline-block", marginTop: 14, background: "rgba(255,255,255,0.2)", color: "#fff", textDecoration: "none", padding: "8px 16px", borderRadius: 99, fontSize: 13, fontWeight: 600 }}>
            Se oppskrift på {todayMeal.source} →
          </a>
        ) : null}
      </div>
      {todayChores.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <h3 style={{ fontSize: 16, fontWeight: 700, color: "#111827", margin: "0 0 12px" }}>Husarbeid i dag</h3>
          {todayChores.map((c, i) => (
            <div key={i} onClick={() => setDoneChores(d => ({...d, [i]: !d[i]}))} style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", background: doneChores[i] ? "#f0fdf4" : "#fff", border: `1px solid ${doneChores[i] ? "#bbf7d0" : "#e5e7eb"}`, borderRadius: 12, marginBottom: 8, cursor: "pointer" }}>
              <span style={{ fontSize: 24 }}>{c.icon}</span>
              <div style={{ flex: 1 }}>
                <p style={{ margin: 0, fontWeight: 600, fontSize: 15, color: "#111827", textDecoration: doneChores[i] ? "line-through" : "none" }}>{c.task}</p>
                <p style={{ margin: "2px 0 0", fontSize: 12, color: "#9ca3af" }}>{c.frequency}</p>
              </div>
              <div style={{ width: 28, height: 28, borderRadius: 99, border: `2px solid ${doneChores[i] ? "#22c55e" : "#d1d5db"}`, background: doneChores[i] ? "#22c55e" : "transparent", display: "flex", alignItems: "center", justifyContent: "center" }}>
                {doneChores[i] && <span style={{ color: "#fff", fontSize: 16, fontWeight: 700 }}>✓</span>}
              </div>
            </div>
          ))}
        </div>
      )}
      <div style={{ background: "#fef3c7", borderRadius: 12, padding: 16 }}>
        <p style={{ margin: 0, fontWeight: 700, fontSize: 14, color: "#92400e" }}>🍼 Mazie-oppdatering</p>
        <p style={{ margin: "6px 0 0", fontSize: 13, color: "#92400e" }}>Termin tidlig mai — etter fødsel justerer vi automatisk til enklere oppskrifter, batch-cooking og babyvarer på handlelisten.</p>
      </div>
    </div>
  );
}

function MealsView({ meals, setMeals }) {
  const [swapDay, setSwapDay] = useState(null);
  const [customInput, setCustomInput] = useState("");

  const pickAlt = (dayIdx, alt) => {
    setMeals(prev => prev.map((m, i) => i === dayIdx ? { ...m, meal: alt.meal, time: alt.time, category: alt.category, source: alt.source, url: alt.url, ingredients: alt.ingredients || m.ingredients, swapped: true } : m));
    setSwapDay(null);
    setCustomInput("");
  };

  const pickCustom = (dayIdx) => {
    if (!customInput.trim()) return;
    setMeals(prev => prev.map((m, i) => i === dayIdx ? { ...m, meal: customInput.trim(), time: "?", source: "Eget valg", url: "", swapped: true } : m));
    setSwapDay(null);
    setCustomInput("");
  };

  const swapDays = (fromIdx, toIdx) => {
    setMeals(prev => {
      const next = [...prev];
      const tempMeal = { ...next[fromIdx], day: DAYS[toIdx] };
      const tempMeal2 = { ...next[toIdx], day: DAYS[fromIdx] };
      next[fromIdx] = tempMeal2;
      next[toIdx] = tempMeal;
      return next;
    });
  };

  return (
    <div style={{ padding: "20px 16px 100px" }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, margin: "0 0 4px", color: "#111827" }}>Ukemeny</h1>
      <p style={{ color: "#6b7280", fontSize: 13, margin: "0 0 20px" }}>Uke 15 — Generert søndag 14:00</p>

      {meals.map((m, i) => {
        return (
          <div key={i} style={{ background: i === TODAY_INDEX ? "#faf5ff" : "#fff", border: `1px solid ${i === TODAY_INDEX ? "#c4b5fd" : "#e5e7eb"}`, borderRadius: 14, padding: 16, marginBottom: 10, position: "relative" }}>
            {i === TODAY_INDEX && <span style={{ position: "absolute", top: -8, right: 12, background: "#7c3aed", color: "#fff", fontSize: 11, fontWeight: 700, padding: "2px 10px", borderRadius: 99 }}>I DAG</span>}
            {m.swapped && <span style={{ position: "absolute", top: -8, left: 12, background: "#10b981", color: "#fff", fontSize: 11, fontWeight: 700, padding: "2px 10px", borderRadius: 99 }}>BYTTET</span>}

            <p style={{ fontSize: 12, fontWeight: 700, color: "#6b7280", margin: 0, textTransform: "uppercase" }}>{m.day}</p>
            <p style={{ fontSize: 16, fontWeight: 700, color: "#111827", margin: "4px 0" }}>{m.meal}</p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
              <span style={{ fontSize: 12, background: `${categoryColors[m.category]}15`, color: categoryColors[m.category], padding: "2px 8px", borderRadius: 99, fontWeight: 600 }}>{categoryLabels[m.category]}</span>
              <span style={{ fontSize: 12, color: "#9ca3af" }}>⏱ {m.time}</span>
            </div>

            <div style={{ display: "flex", gap: 6, marginTop: 10, alignItems: "center" }}>
              {i > 0 && <button onClick={() => swapDays(i, i - 1)} style={{ background: "#f3f4f6", border: "1px solid #e5e7eb", borderRadius: 8, padding: "6px 10px", fontSize: 14, cursor: "pointer", color: "#374151", fontWeight: 600, lineHeight: 1 }}>↑</button>}
              {i < 6 && <button onClick={() => swapDays(i, i + 1)} style={{ background: "#f3f4f6", border: "1px solid #e5e7eb", borderRadius: 8, padding: "6px 10px", fontSize: 14, cursor: "pointer", color: "#374151", fontWeight: 600, lineHeight: 1 }}>↓</button>}
            </div>

            <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap", alignItems: "center" }}>
              {m.url ? (
                <a href={m.url} target="_blank" rel="noopener" style={{ color: "#7c3aed", textDecoration: "none", fontSize: 13, fontWeight: 600 }}>
                  Oppskrift → {m.source}
                </a>
              ) : m.source ? (
                <span style={{ fontSize: 13, color: "#9ca3af" }}>{m.source}</span>
              ) : null}
              <button onClick={() => setSwapDay(swapDay === i ? null : i)} style={{ marginLeft: "auto", background: swapDay === i ? "#fef2f2" : "#f5f3ff", border: `1px solid ${swapDay === i ? "#fecaca" : "#e9e5ff"}`, borderRadius: 8, padding: "5px 12px", fontSize: 12, color: swapDay === i ? "#dc2626" : "#7c3aed", fontWeight: 600, cursor: "pointer" }}>
                {swapDay === i ? "Avbryt" : "Bytt middag"}
              </button>
            </div>

            {swapDay === i && (
              <div style={{ marginTop: 14, borderTop: "1px solid #e5e7eb", paddingTop: 14 }}>
                <p style={{ fontSize: 13, fontWeight: 700, color: "#374151", margin: "0 0 4px" }}>Forslag basert på det dere liker:</p>
                {(altSuggestions[m.day] || []).map((alt, ai) => (
                  <div key={ai} onClick={() => pickAlt(i, alt)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", background: "#f9fafb", borderRadius: 10, marginBottom: 6, cursor: "pointer", border: "1px solid #e5e7eb" }}>
                    <div style={{ flex: 1 }}>
                      <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "#111827" }}>{alt.meal}</p>
                      <p style={{ margin: "3px 0 0", fontSize: 12, color: "#6b7280" }}>{alt.reason}</p>
                    </div>
                    <div style={{ width: 32, height: 32, borderRadius: 99, background: "#ede9fe", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      <span style={{ color: "#7c3aed", fontSize: 16 }}>→</span>
                    </div>
                  </div>
                ))}
                <p style={{ fontSize: 13, fontWeight: 700, color: "#374151", margin: "12px 0 6px" }}>Eller skriv hva du har lyst på:</p>
                <div style={{ display: "flex", gap: 8 }}>
                  <input value={customInput} onChange={e => setCustomInput(e.target.value)} onKeyDown={e => e.key === "Enter" && pickCustom(i)} placeholder="F.eks. «taco med pulled pork»" style={{ flex: 1, padding: "10px 12px", borderRadius: 10, border: "1px solid #d1d5db", fontSize: 14, outline: "none" }} />
                  <button onClick={() => pickCustom(i)} style={{ background: "#7c3aed", color: "#fff", border: "none", borderRadius: 10, padding: "10px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}>Velg</button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ShoppingView({ meals, knowledgeBase, setKnowledgeBase }) {
  const shoppingList = buildSmartShoppingList(meals, knowledgeBase);
  const [statusMap, setStatusMap] = useState({});
  const [showAtHome, setShowAtHome] = useState(false);

  const toggleItem = (name) => {
    setStatusMap(prev => ({ ...prev, [name]: { ...prev[name], checked: !(prev[name]?.checked), atHome: false } }));
  };

  const markAtHome = (name, e) => {
    e.stopPropagation();
    const product = productDB[name.toLowerCase()];
    if (product) {
      setKnowledgeBase(prev => ({
        ...prev,
        [name.toLowerCase()]: {
          ...prev[name.toLowerCase()],
          lastPurchased: new Date().toISOString().split('T')[0],
          packSize: product.packSize,
          estimatedRemaining: product.packSize,
          usedInMeals: [],
          totalPurchases: (prev[name.toLowerCase()]?.totalPurchases || 0) + 1,
        }
      }));
    }
    setStatusMap(prev => ({ ...prev, [name]: { checked: false, atHome: !(prev[name]?.atHome) } }));
  };

  const items = shoppingList.map(cat => ({
    ...cat,
    items: cat.items.map(it => ({
      ...it,
      checked: statusMap[it.name]?.checked || false,
      atHome: statusMap[it.name]?.atHome || false,
    }))
  }));

  const needToBuy = items.map(cat => ({ ...cat, items: cat.items.filter(i => !i.atHome) })).filter(cat => cat.items.length > 0);
  const atHomeItems = items.map(cat => ({ ...cat, items: cat.items.filter(i => i.atHome) })).filter(cat => cat.items.length > 0);
  const atHomeCount = atHomeItems.reduce((s, c) => s + c.items.length, 0);
  const totalItems = needToBuy.reduce((s, c) => s + c.items.length, 0);
  const checkedItems = needToBuy.reduce((s, c) => s + c.items.filter(i => i.checked).length, 0);
  const progress = totalItems > 0 ? (checkedItems / totalItems) * 100 : 0;

  const totalPrice = needToBuy.reduce((sum, cat) =>
    sum + cat.items.reduce((s, it) => {
      if (it.product) {
        return s + (it.product.estPrice * it.packCount);
      }
      return s;
    }, 0), 0
  );

  return (
    <div style={{ padding: "20px 16px 100px" }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, margin: "0 0 4px", color: "#111827" }}>Handleliste</h1>
      <p style={{ color: "#6b7280", fontSize: 13, margin: "0 0 16px" }}>Uke 15 — {totalItems} varer å handle</p>
      <div style={{ background: "#f3f4f6", borderRadius: 99, height: 8, marginBottom: 6, overflow: "hidden" }}>
        <div style={{ background: "linear-gradient(90deg, #7c3aed, #a78bfa)", height: "100%", width: `${progress}%`, borderRadius: 99, transition: "width 0.3s" }} />
      </div>
      <p style={{ fontSize: 12, color: "#6b7280", margin: "0 0 20px", textAlign: "right" }}>{checkedItems} av {totalItems} handlet</p>
      <div style={{ background: "#ede9fe", borderRadius: 10, padding: "10px 14px", marginBottom: 20, display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 18 }}>🏪</span>
        <p style={{ margin: 0, fontSize: 13, color: "#5b21b6", fontWeight: 600 }}>Hovedhandel: Kiwi (Røros-meieriet!) — Est. ca. {totalPrice} kr</p>
      </div>
      {needToBuy.map((cat) => (
        <div key={cat.category} style={{ marginBottom: 20 }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, color: "#374151", margin: "0 0 8px", textTransform: "uppercase", letterSpacing: 0.5 }}>{cat.category}</h3>
          {cat.items.map((item) => (
            <div key={item.name} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderBottom: "1px solid #f3f4f6" }}>
              <div onClick={() => toggleItem(item.name)} style={{ width: 24, height: 24, borderRadius: 6, border: `2px solid ${item.checked ? "#7c3aed" : "#d1d5db"}`, background: item.checked ? "#7c3aed" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, cursor: "pointer" }}>
                {item.checked && <span style={{ color: "#fff", fontSize: 14, fontWeight: 700 }}>✓</span>}
              </div>
              <div onClick={() => toggleItem(item.name)} style={{ flex: 1, cursor: "pointer" }}>
                <p style={{ margin: 0, fontSize: 15, color: item.checked ? "#9ca3af" : "#111827", textDecoration: item.checked ? "line-through" : "none", fontWeight: 500 }}>{item.name}</p>
                {item.product && (
                  <p style={{ margin: "2px 0 0", fontSize: 12, color: "#9ca3af" }}>{item.packCount} pk à {item.product.packSize}{item.product.unit} — ca. {item.product.estPrice * item.packCount} kr</p>
                )}
              </div>
              <button onClick={(e) => markAtHome(item.name, e)} style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 8, padding: "4px 10px", fontSize: 12, color: "#15803d", fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0 }}>Har hjemme</button>
            </div>
          ))}
        </div>
      ))}
      {atHomeCount > 0 && (
        <div style={{ marginTop: 8 }}>
          <button onClick={() => setShowAtHome(!showAtHome)} style={{ background: "none", border: "none", padding: "12px 0", cursor: "pointer", display: "flex", alignItems: "center", gap: 8, width: "100%" }}>
            <div style={{ background: "#dcfce7", borderRadius: 99, width: 24, height: 24, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13 }}>🏠</div>
            <span style={{ fontSize: 14, fontWeight: 600, color: "#15803d" }}>Har hjemme ({atHomeCount} varer)</span>
            <span style={{ marginLeft: "auto", fontSize: 18, color: "#9ca3af", transform: showAtHome ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.2s" }}>▾</span>
          </button>
          {showAtHome && atHomeItems.map((cat) => (
            <div key={cat.category} style={{ marginBottom: 12, paddingLeft: 8 }}>
              {cat.items.map((item) => (
                <div key={item.name} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: "1px solid #f3f4f6" }}>
                  <span style={{ fontSize: 14 }}>🏠</span>
                  <span style={{ flex: 1, fontSize: 14, color: "#6b7280" }}>{item.name}</span>
                  <button onClick={(e) => markAtHome(item.name, e)} style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: "4px 10px", fontSize: 12, color: "#dc2626", fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0 }}>Trenger likevel</button>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ChoresView({ choresData, setChoresData }) {
  const [doneMap, setDoneMap] = useState({});
  const dayOrder = ["Mandag", "Tirsdag", "Onsdag", "Torsdag", "Fredag", "—"];

  const postpone = (choreIdx) => {
    setChoresData(prev => prev.map((c, i) => {
      if (i !== choreIdx) return c;
      const currentDayIdx = DAYS.indexOf(c.day);
      if (currentDayIdx === -1) return c;
      const nextDay = currentDayIdx >= 4 ? "Mandag" : DAYS[currentDayIdx + 1];
      const label = currentDayIdx >= 4 ? "neste mandag" : null;
      return { ...c, day: nextDay, postponed: true, postponedLabel: label };
    }));
  };

  const grouped = {};
  choresData.forEach((c, i) => { if (!grouped[c.day]) grouped[c.day] = []; grouped[c.day].push({ ...c, _idx: i }); });

  return (
    <div style={{ padding: "20px 16px 100px" }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, margin: "0 0 4px", color: "#111827" }}>Husarbeid</h1>
      <p style={{ color: "#6b7280", fontSize: 13, margin: "0 0 20px" }}>Ingen husarbeid lørdag eller søndag!</p>

      {dayOrder.filter(d => grouped[d]).map(day => (
        <div key={day} style={{ marginBottom: 20 }}>
          <h3 style={{ fontSize: 13, fontWeight: 700, color: day === DAYS[TODAY_INDEX] ? "#7c3aed" : "#6b7280", margin: "0 0 8px", textTransform: "uppercase", letterSpacing: 0.5 }}>
            {day === "—" ? "Etter behov" : day} {day === DAYS[TODAY_INDEX] && " ← i dag"}
          </h3>
          {grouped[day].map((c) => {
            const key = c._idx;
            const canPostpone = c.day !== "—";
            return (
              <div key={key} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", background: doneMap[key] ? "#f0fdf4" : "#fff", border: `1px solid ${doneMap[key] ? "#bbf7d0" : "#e5e7eb"}`, borderRadius: 12, marginBottom: 8 }}>
                <div onClick={() => setDoneMap(d => ({...d, [key]: !d[key]}))} style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, cursor: "pointer" }}>
                  <span style={{ fontSize: 22 }}>{c.icon}</span>
                  <div style={{ flex: 1 }}>
                    <p style={{ margin: 0, fontWeight: 600, fontSize: 15, color: "#111827", textDecoration: doneMap[key] ? "line-through" : "none" }}>{c.task}</p>
                    <p style={{ margin: "2px 0 0", fontSize: 12, color: "#9ca3af" }}>
                      {c.frequency}{c.biweekly ? " (denne uka: ja)" : ""}
                      {c.postponed && <span style={{ color: "#f59e0b", fontWeight: 600 }}> · Utsatt{c.postponedLabel ? ` til ${c.postponedLabel}` : ""}</span>}
                    </p>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6, alignItems: "center", flexShrink: 0 }}>
                  {canPostpone && !doneMap[key] && (
                    <button onClick={() => postpone(c._idx)} style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8, padding: "4px 8px", fontSize: 11, color: "#b45309", fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}>Utsett</button>
                  )}
                  <div onClick={() => setDoneMap(d => ({...d, [key]: !d[key]}))} style={{ width: 28, height: 28, borderRadius: 99, border: `2px solid ${doneMap[key] ? "#22c55e" : "#d1d5db"}`, background: doneMap[key] ? "#22c55e" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
                    {doneMap[key] && <span style={{ color: "#fff", fontSize: 16, fontWeight: 700 }}>✓</span>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

export default function App() {
  const [tab, setTab] = useState("today");
  const [meals, setMeals] = useState(mealPlanInit);
  const [choresData, setChoresData] = useState(choresInit);
  const [knowledgeBase, setKnowledgeBase] = useState(knowledgeBaseInit);

  return (
    <div style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif", background: "#f9fafb", minHeight: "100vh", maxWidth: 480, margin: "0 auto", position: "relative" }}>
      <div style={{ background: "linear-gradient(135deg, #7c3aed 0%, #5b21b6 100%)", padding: "16px 16px 12px", color: "#fff" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h1 style={{ fontSize: 18, fontWeight: 800, margin: 0, letterSpacing: -0.5 }}>Familieassistenten</h1>
            <p style={{ fontSize: 12, opacity: 0.8, margin: "2px 0 0" }}>Frestad — Heia 9, Kristiansand</p>
          </div>
          <p style={{ fontSize: 22, margin: 0 }}>👨‍👩‍👧</p>
        </div>
      </div>

      {tab === "today" && <TodayView meals={meals} choresData={choresData} />}
      {tab === "meals" && <MealsView meals={meals} setMeals={setMeals} />}
      {tab === "shopping" && <ShoppingView meals={meals} knowledgeBase={knowledgeBase} setKnowledgeBase={setKnowledgeBase} />}
      {tab === "chores" && <ChoresView choresData={choresData} setChoresData={setChoresData} />}

      <TabBar active={tab} setActive={setTab} />
    </div>
  );
}
