# Home Assistant: today's dinner

Use a family token from Settings → Tilgang for Home Assistant.
Do not use the instance-wide `AUTH_TOKEN`. That key belongs to family 1
and is not an integration credential.

The token is shown once. If it is lost, revoke it and create another.

## REST sensor

```yaml
rest:
  - resource: http://192.168.50.123:7777/api/today
    headers:
      Authorization: Bearer fa_paste-the-family-token
    scan_interval: 300
    sensor:
      - name: Family dinner
        value_template: "{{ value_json.meal.recipe.name | default('Ingen middag') }}"
        json_attributes:
          - dayName
          - chores
```

`GET /api/today` needs the `read` scope. Marking a dinner cooked is
`POST /api/meals/<id>/mark-eaten` and needs `meals:cooked`.
Completing a chore is `PUT /api/chores/complete` and needs `chores:write`.
Adding a shopping line is `POST /api/shopping/add` and needs `shopping:write`.

A token from one family cannot read another family's data.
