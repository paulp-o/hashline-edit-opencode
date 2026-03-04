# OpenCode Tool UI — 커스텀 타이틀 표시

## 문제

OpenCode UI는 tool call을 이렇게 표시한다:
```
⚙ tool_name [param1=value1, param2=value2]
```
**스칼라 파라미터**(string, number, boolean)만 인라인 표시된다.
array/object 파라미터는 **생략**된다.

예:
```
⚙ hashline_read [filePath=src/index.ts, offset=77, limit=15]  ← 전부 스칼라, 다 보임
⚙ hashline_edit [path=src/index.ts]                           ← edits(array)는 생략됨
```

## 해결

`context.metadata()`로 커스텀 타이틀을 설정하면 OpenCode가 그걸 표시한다.

```typescript
tool({
  description: '...',
  args: { /* ... */ },
  async execute(args, context) {
    // 이 한 줄이 핵심
    context.metadata({ title: 'src/index.ts — repl 45#XR, del 67#PP' });

    // ... 나머지 로직
  },
});
```

## 결과

```
⚙ hashline_edit src/index.ts — repl 45#XR, del 67#PP
```

## 레퍼런스

- `ask-user-questions-mcp`의 `packages/opencode-plugin/src/index.ts:99-101`에서 동일 패턴 사용
- `context.metadata()`는 `title`과 `metadata` 두 필드를 받는다
- `title`만 설정해도 UI 표시에 충분하다