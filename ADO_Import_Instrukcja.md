# Import backlogu CodeRAG do Azure DevOps

## Problem
ADO MCP connector miał timeout podczas sesji. Backlog jest przygotowany w pliku `CodeRAG_Backlog_i_Prompty.md`.

## Jak zaimportować

### Opcja 1: Popros Claude o import (gdy ADO wróci)
Otwórz nową sesję z Claude i powiedz:
```
Przeczytaj plik CodeRAG_Backlog_i_Prompty.md i zaimportuj wszystkie Epics i User Stories do projektu CodeRAG w ADO. Każdy Epic powinien mieć child stories. Oznacz MVP stories tagiem "MVP". Użyj priorytetów P1-P4. Effort mapuj na Story Points: S=2, M=5, L=8, XL=13.
```

### Opcja 2: Import via CSV w ADO
1. Otwórz ADO → CodeRAG → Boards → Queries
2. New query → Import from CSV
3. Użyj poniższego formatu CSV

### Opcja 3: Azure DevOps CLI
```bash
az boards work-item create --title "EPIC 0: Project Setup" --type Epic --project CodeRAG
az boards work-item create --title "Inicjalizacja repozytorium" --type "User Story" --project CodeRAG --parent <epic_id>
```

## Struktura Work Items
- **Epic** → User Story → Task
- Tags: `MVP`, `Phase-0`, `Phase-1`, `Phase-2`, `Phase-3`, `Phase-4`
- Priority: 1 (P1) → 4 (P4)
- Story Points: S=2, M=5, L=8, XL=13
