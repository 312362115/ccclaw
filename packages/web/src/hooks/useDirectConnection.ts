import { useEffect, useRef, useCallback } from 'react';
import { DirectWsClient } from '../api/direct-ws';
import { useFileTreeStore } from '../stores/file-tree';

export function useDirectConnection(workspaceId: string | null) {
  const clientRef = useRef<DirectWsClient | null>(null);
  const store = useFileTreeStore;

  useEffect(() => {
    if (!workspaceId) return;

    const client = new DirectWsClient({
      workspaceId,
      onStateChange: (state) => {
        store.getState().setConnectionState(state);
      },
      onMessage: (msg) => {
        const s = store.getState();

        if (msg.channel === 'tree') {
          if (msg.action === 'snapshot') {
            if (msg.data.path === '/') {
              s.setEntries(msg.data.entries, msg.data.truncated);
            } else {
              s.mergeSubtree(msg.data.path, msg.data.entries);
            }
          } else if (msg.action === 'event') {
            s.applyEvents(msg.data.events);
          }
        } else if (msg.channel === 'file') {
          if (msg.action === 'read_result') {
            s.setPreview(msg.data.path, msg.data.content, msg.data.binary);
          }
          // create_result / delete_result handled by tree:event auto-push
        }
      },
    });

    clientRef.current = client;

    // Connect and request initial tree
    client
      .connect()
      .then(() => {
        client.send({
          channel: 'tree',
          action: 'list',
          requestId: 'init-' + Date.now(),
          data: { path: '/', depth: 2 },
        });
      })
      .catch(() => {
        // Fallback to RELAY — DirectWsClient handles this internally
      });

    return () => {
      client.disconnect();
      clientRef.current = null;
    };
  }, [workspaceId]);

  const sendDirectMessage = useCallback((msg: any) => {
    clientRef.current?.send(msg);
  }, []);

  return { sendDirectMessage };
}
