import asyncio
import websockets
import json
import logging
import time
import uuid
from dataclasses import dataclass, field
from typing import Optional, List, Dict
from enum import Enum

# Assuming FastMCP structure
from fastmcp import FastMCP, Context
import sys  # For Windows event policy

# Configure logging
logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)

# Server configuration
SERVER_HOST = "0.0.0.0"
WS_PORT = 8080
MCP_PORT = 8081


class ClientStatus(Enum):
    IDLE = "idle"
    BUSY = "busy"


@dataclass
class Client:
    """WebSocket客户端信息"""

    id: str
    websocket: websockets.WebSocketServer
    status: ClientStatus = ClientStatus.IDLE
    current_task_id: Optional[str] = None
    last_active: float = field(default_factory=time.time)
    url: Optional[str] = None

    def update_activity(self):
        """更新客户端活动时间"""
        self.last_active = time.time()


@dataclass
class Task:
    """任务信息"""

    id: str
    prompt: str
    ratio: str
    file_url: str
    client_id: str
    create_time: float
    timeout: float = 120.0
    image_urls: List[str] = field(default_factory=list)
    status: str = "pending"
    task_type: str = "image"

    def is_timeout(self) -> bool:
        """检查任务是否超时"""
        return time.time() - self.create_time > self.timeout

    def to_dict(self):
        """将任务转换为字典，用于发送给客户端"""
        return {
            "commandId": self.id, # 使用 commandId 确保与客户端一致
            "prompt": self.prompt,
            "ratio": self.ratio,
            "file": self.file_url, # 客户端期望的字段名是 'file'
            "imageUrl": self.file_url, # 也包含 imageUrl
            "task_type": self.task_type,
        }


@dataclass
class AppContext:
    """应用上下文"""
    clients: Dict[str, Client] = field(default_factory=dict)
    tasks: Dict[str, Task] = field(default_factory=dict)
    round_robin_index: int = 0

    def add_client(self, client_id: str, websocket: websockets.WebSocketServer):
        self.clients[client_id] = Client(id=client_id, websocket=websocket)
        logger.info(f"Client {client_id} added. Total clients: {len(self.clients)}")

    def remove_client(self, client_id: str):
        if client_id in self.clients:
            for task in self.tasks.values():
                if task.client_id == client_id and task.status == "pending":
                    task.status = "error"
                    logger.warning(
                        f"Task {task.id} marked as error due to client disconnect"
                    )
            del self.clients[client_id]
            logger.info(
                f"Client {client_id} removed. Total clients: {len(self.clients)}"
            )

    def get_idle_client(self) -> Optional[Client]:
        if not self.clients: return None
        client_ids = list(self.clients.keys())
        if not client_ids: return None

        start_index = self.round_robin_index
        for i in range(len(client_ids)):
            index = (start_index + i) % len(client_ids)
            client_id = client_ids[index]
            client = self.clients[client_id]

            if (
                client.status == ClientStatus.IDLE
                and hasattr(client.websocket, "state")
                and client.websocket.state == websockets.State.OPEN
            ):
                self.round_robin_index = (index + 1) % len(client_ids)
                return client
        return None

    def set_client_busy(self, client_id: str, task_id: str):
        if client_id in self.clients:
            self.clients[client_id].status = ClientStatus.BUSY
            self.clients[client_id].current_task_id = task_id
            self.clients[client_id].update_activity()

    def set_client_idle(self, client_id: str):
        if client_id in self.clients:
            self.clients[client_id].status = ClientStatus.IDLE
            self.clients[client_id].current_task_id = None
            self.clients[client_id].update_activity()

    def handle_script_ready(self, client_id: str, url: str):
        if client_id in self.clients:
            self.clients[client_id].url = url
            self.clients[client_id].update_activity()
            logger.info(f"Client {client_id} script ready at {url}")

    def create_task(
        self, prompt: str, ratio: str, client_id: str, file_url: str = None
    ) -> Task:
        task_id = str(uuid.uuid4())
        task = Task(
            id=task_id,
            prompt=prompt,
            ratio=ratio,
            file_url=file_url,
            client_id=client_id,
            create_time=time.time(),
        )
        self.tasks[task_id] = task
        return task

    def complete_task(self, task_id: str, image_urls: List[str]):
        if task_id in self.tasks:
            task = self.tasks[task_id]
            if task.status == "pending":
                task.image_urls = image_urls
                task.status = "completed"
                self.set_client_idle(task.client_id)
                logger.info(f"Task {task_id} completed with {len(image_urls)} images")
            else:
                 logger.warning(f"Attempted to complete an already finished task: {task_id}")
        else:
            logger.warning(f"Task {task_id} not found for completion.")

    def timeout_task(self, task_id: str):
        if task_id in self.tasks and self.tasks[task_id].status == "pending":
            task = self.tasks[task_id]
            task.status = "timeout"
            self.set_client_idle(task.client_id)
            logger.warning(f"Task {task_id} timed out")

    def check_timeouts(self):
        for task in list(self.tasks.values()):
            if task.status == "pending" and task.is_timeout():
                self.timeout_task(task.id)
    
    def cleanup_disconnected_clients(self):
        clients_to_remove = [
            cid for cid, c in self.clients.items() 
            if not hasattr(c.websocket, "state") or c.websocket.state != websockets.State.OPEN
        ]
        for client_id in clients_to_remove:
            self.remove_client(client_id)


# --- WebSocket Server Handler ---
async def websocket_handler(websocket, app_context: AppContext):
    client_id = str(uuid.uuid4())
    logger.info(f"Client {client_id} connected from {websocket.remote_address}")
    app_context.add_client(client_id, websocket)

    try:
        async for message in websocket:
            if client_id in app_context.clients:
                app_context.clients[client_id].update_activity()
            
            try:
                data = json.loads(message)
                msg_type = data.get("type")

                if msg_type == "ping":
                    await send_to_client(websocket, json.dumps({"type": "pong"}))
                    continue
                
                elif msg_type == "collectedImageUrls":
                    command_id = data.get("commandId")
                    urls = data.get("urls")
                    if command_id and urls is not None:
                        app_context.complete_task(command_id, urls)
                    else:
                        logger.warning(f"Invalid 'collectedImageUrls' from {client_id}: {data}")
                    continue

                elif msg_type == "scriptReady":
                    url = data.get("url")
                    if url:
                        app_context.handle_script_ready(client_id, url)
                    continue
                
                elif msg_type == "error":
                    command_id = data.get("commandId")
                    logger.error(f"Error reported from client {client_id} for task {command_id}: {data.get('errorDetails')}")
                    if command_id in app_context.tasks:
                        app_context.tasks[command_id].status = "error"
                        app_context.set_client_idle(app_context.tasks[command_id].client_id)
                    continue

                logger.warning(f"Unknown message type from {client_id}: {msg_type}")

            except json.JSONDecodeError:
                logger.warning(f"Non-JSON message from {client_id}: {message[:200]}...")
            except Exception as e:
                logger.error(f"Error processing message from {client_id}: {e}", exc_info=True)

    except websockets.exceptions.ConnectionClosed:
        logger.info(f"Client {client_id} disconnected")
    except Exception as e:
        logger.error(f"Handler error for {client_id}: {e}", exc_info=True)
    finally:
        app_context.remove_client(client_id)


async def send_to_client(websocket, message: str):
    try:
        if hasattr(websocket, "state") and websocket.state == websockets.State.OPEN:
            await websocket.send(message)
            return True
        return False
    except websockets.exceptions.ConnectionClosed:
        return False
    except Exception as e:
        logger.error(f"Error sending to client: {e}")
        return False

# --- Main Async Entry Point & FastMCP Tools ---
async def main_async():
    app_context = AppContext()
    mcp = FastMCP(name="WebSocketMCP", json_response=True)

    @mcp.tool()
    async def draw_image(
        ctx: Context, prompt: str, ratio: str = "2:3"
    ) -> str:
        """
        文生图功能：根据文本提示词生成图片
        
        Args:
            prompt (str): 图片生成的文本描述，描述你希望生成的图片内容。例如："一只可爱的小猫坐在花园里"、"现代风格的建筑"等
            ratio (str, optional): 图片的宽高比例，默认为"2:3"。支持的比例包括：
                - "1:1" - 正方形
                - "2:3" - 竖版（默认）
                - "3:2" - 横版
                - "16:9" - 宽屏
                - "9:16" - 竖屏
                - "4:3" - 标准横版
                - "3:4" - 标准竖版
        
        Returns:
            str: JSON格式的响应，包含以下字段：
                - status: "success" 或 "error"
                - image_urls: 成功时返回图片URL列表
                - message: 错误时的错误信息
        
        Example:
            draw_image(prompt="一只可爱的小猫", ratio="1:1")
            draw_image(prompt="现代城市夜景", ratio="16:9")
        """
        try:
            if not prompt or not prompt.strip():
                return json.dumps({"status": "error", "message": "Prompt cannot be empty"}, ensure_ascii=False)
            
            app_context.check_timeouts()
            app_context.cleanup_disconnected_clients()

            idle_client = app_context.get_idle_client()
            if not idle_client:
                return json.dumps({"status": "error", "message": "No idle clients available"}, ensure_ascii=False)
            
            task = app_context.create_task(
                prompt=prompt, ratio=ratio, file_url=None, client_id=idle_client.id
            )
            app_context.set_client_busy(idle_client.id, task.id)

            success = await send_to_client(idle_client.websocket, json.dumps(task.to_dict(), ensure_ascii=False))
            if not success:
                app_context.set_client_idle(idle_client.id)
                task.status = "error"
                return json.dumps({"status": "error", "message": "Failed to send task to client"}, ensure_ascii=False)

            logger.info(f"Task {task.id} sent to client {idle_client.id}")
            
            start_time = time.time()
            while time.time() - start_time < task.timeout:
                current_task = app_context.tasks.get(task.id)
                if not current_task: break

                if current_task.status == "completed":
                    return json.dumps({"status": "success", "image_urls": current_task.image_urls}, ensure_ascii=False)
                elif current_task.status in ["timeout", "error"]:
                    return json.dumps({"status": "error", "message": f"Task {current_task.status}"}, ensure_ascii=False)
                
                await asyncio.sleep(1)

            app_context.timeout_task(task.id)
            return json.dumps({"status": "error", "message": "Task timeout"}, ensure_ascii=False)
        except Exception as e:
            logger.error(f"Error in draw_image: {e}", exc_info=True)
            return json.dumps({"status": "error", "message": f"Internal error: {e}"}, ensure_ascii=False)

    @mcp.tool()
    async def edit_image(
        ctx: Context, prompt: str, reference_picture: str, ratio: str = "2:3"
    ) -> str:
        """
        图生图功能：根据参考图片和文本提示词生成或编辑图片
        
        Args:
            prompt (str): 图片编辑的文本描述，描述你希望对参考图片进行的修改或生成的新内容。
                例如："将这张图片变成卡通风格"、"添加彩虹背景"、"改变颜色为黑白"等
            reference_picture (str): 参考图片的网络地址URL，必须是可访问的HTTP或HTTPS链接。
                图片将作为生成的基础或参考。例如："https://example.com/image.jpg"
            ratio (str, optional): 生成图片的宽高比例，默认为"2:3"。支持的比例包括：
                - "1:1" - 正方形
                - "2:3" - 竖版（默认）
                - "3:2" - 横版
                - "16:9" - 宽屏
                - "9:16" - 竖屏
                - "4:3" - 标准横版
                - "3:4" - 标准竖版
        
        Returns:
            str: JSON格式的响应，包含以下字段：
                - status: "success" 或 "error"
                - image_urls: 成功时返回生成图片的URL列表
                - message: 错误时的错误信息
        
        Example:
            edit_image(
                prompt="将这张图片变成水彩画风格", 
                reference_picture="https://example.com/photo.jpg", 
                ratio="1:1"
            )
            edit_image(
                prompt="添加夕阳背景", 
                reference_picture="https://example.com/portrait.png", 
                ratio="3:4"
            )
        
        Note:
            - reference_picture 必须是有效的图片URL，支持常见格式：jpg, jpeg, png, gif, webp
            - 图片URL必须是公开可访问的，不能需要认证
            - 建议图片大小不超过10MB，分辨率建议在1024x1024以内
        """
        try:
            if not prompt or not prompt.strip():
                return json.dumps({"status": "error", "message": "Prompt cannot be empty"}, ensure_ascii=False)
            
            if not reference_picture or not reference_picture.strip():
                return json.dumps({"status": "error", "message": "Reference picture URL cannot be empty"}, ensure_ascii=False)
            
            # 验证图片URL格式
            if not (reference_picture.startswith("http://") or reference_picture.startswith("https://")):
                return json.dumps({"status": "error", "message": "Reference picture must be a valid HTTP/HTTPS URL"}, ensure_ascii=False)
            
            app_context.check_timeouts()
            app_context.cleanup_disconnected_clients()

            idle_client = app_context.get_idle_client()
            if not idle_client:
                return json.dumps({"status": "error", "message": "No idle clients available"}, ensure_ascii=False)
            
            task = app_context.create_task(
                prompt=prompt, ratio=ratio, file_url=reference_picture, client_id=idle_client.id
            )
            app_context.set_client_busy(idle_client.id, task.id)

            success = await send_to_client(idle_client.websocket, json.dumps(task.to_dict(), ensure_ascii=False))
            if not success:
                app_context.set_client_idle(idle_client.id)
                task.status = "error"
                return json.dumps({"status": "error", "message": "Failed to send task to client"}, ensure_ascii=False)

            logger.info(f"Edit image task {task.id} sent to client {idle_client.id}")
            
            start_time = time.time()
            while time.time() - start_time < task.timeout:
                current_task = app_context.tasks.get(task.id)
                if not current_task: break

                if current_task.status == "completed":
                    return json.dumps({"status": "success", "image_urls": current_task.image_urls}, ensure_ascii=False)
                elif current_task.status in ["timeout", "error"]:
                    return json.dumps({"status": "error", "message": f"Task {current_task.status}"}, ensure_ascii=False)
                
                await asyncio.sleep(1)

            app_context.timeout_task(task.id)
            return json.dumps({"status": "error", "message": "Task timeout"}, ensure_ascii=False)
        except Exception as e:
            logger.error(f"Error in edit_image: {e}", exc_info=True)
            return json.dumps({"status": "error", "message": f"Internal error: {e}"}, ensure_ascii=False)

    @mcp.tool()
    def get_connection_status(ctx: Context) -> str:
        """
        获取服务器连接状态和任务信息
        
        Args:
            无参数
        
        Returns:
            str: JSON格式的响应，包含以下字段：
                - total_clients: 当前连接的客户端总数
                - clients: 客户端详细信息列表，每个客户端包含：
                    - id: 客户端唯一标识
                    - connected: 是否已连接（true/false）
                    - status: 客户端状态（"idle"空闲 或 "busy"忙碌）
                    - current_task: 当前正在执行的任务ID（如果有）
                    - last_active: 最后活动时间戳
                    - url: 客户端连接的页面URL
                - total_tasks: 任务总数
                - tasks: 任务详细信息列表，每个任务包含：
                    - id: 任务唯一标识
                    - client_id: 执行任务的客户端ID
                    - status: 任务状态（"pending"等待、"completed"完成、"timeout"超时、"error"错误）
                    - create_time: 任务创建时间戳
        
        Example:
            get_connection_status()
        
        Use Cases:
            - 检查服务器是否正常运行
            - 查看当前有多少客户端连接
            - 监控任务执行状态
            - 调试连接问题
        """
        client_info = [{
            "id": c.id, "connected": c.websocket.state == websockets.State.OPEN, "status": c.status.value,
            "current_task": c.current_task_id, "last_active": c.last_active, "url": c.url,
        } for c in app_context.clients.values()]

        task_info = [{
            "id": t.id, "client_id": t.client_id, "status": t.status, "create_time": t.create_time,
        } for t in app_context.tasks.values()]

        return json.dumps({
            "total_clients": len(client_info), "clients": client_info,
            "total_tasks": len(task_info), "tasks": task_info,
        }, ensure_ascii=False)

    ws_server = await websockets.serve(lambda ws: websocket_handler(ws, app_context), SERVER_HOST, WS_PORT)
    logger.info(f"WebSocket server started on ws://{SERVER_HOST}:{WS_PORT}")
    mcp_server_task = asyncio.create_task(mcp.run_async(transport="streamable-http", host=SERVER_HOST, port=MCP_PORT))
    logger.info(f"FastMCP server started on http://{SERVER_HOST}:{MCP_PORT}")

    try:
        await asyncio.gather(asyncio.create_task(ws_server.wait_closed()), mcp_server_task)
    finally:
        logger.info("Shutting down...")
        ws_server.close()
        await ws_server.wait_closed()

def main():
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    try:
        asyncio.run(main_async())
    except KeyboardInterrupt:
        logger.info("Application interrupted.")

if __name__ == "__main__":
    main()