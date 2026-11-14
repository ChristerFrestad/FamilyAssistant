-- Recipe 14 was seeded with the same Matprat page as recipe 2
-- (laks-i-airfryer). No separate honey-soy page was found, so existing
-- copies of that dish stop pointing at the other recipe.
UPDATE recipes
   SET url = NULL
 WHERE name = 'Bakt laks med honning og soya i airfryer'
   AND url = 'https://www.matprat.no/oppskrifter/rask/laks-i-airfryer/';
