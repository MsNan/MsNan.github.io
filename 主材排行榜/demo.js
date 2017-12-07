$(function(){
	//搜索框显示
	$(".ss").focus(function(){
		$(".head").css("display","none");
		$(".mid").css("display","none");
		$(".footer").css("display","none");
		$(".search_all").css("display","block");
	});
	// 取消按钮
	$(".cancle").click(function(){
		$(".head").css("display","block");
		$(".mid").css("display","block");
		$(".footer").css("display","block");
		$(".search_all").css("display","none");
	})
	// 删除历史记录操作
	$(".del").click(function(){
		$(".del_all").css("display","block");
	})
	$(".del_exit").click(function(){
		$(".del_all").css("display","none");
	})
	$("#btn_cancle").click(function(){
		$(".del_all").css("display","none");
	})
	$("#btn_sure").click(function(){
		$(".ls").children("li").remove();
		$(".del_all").css("display","none");
		$(".search_ls").css("display","none");
	})

	

	//历史记录功能实现
	$("#ss1").bind("search", function(){
		append();
	})
	function  append(){
		$(".search_ls").show();
		var has = false;
		$(".ls li").each(function(){
			if(this.innerHTML ==$("#ss1").val()){
				has = true;
			}
		});
		if(!has){
			$(".ls").append("<li>"+$("#ss1").val()+"</li>");
		}
	}
	// 历史记录显示隐藏
	if($(".ls > li").length > 0){
		$(".search_ls").show();
	}
	else{
		$(".search_ls").hide();
	}
	// li插入input
	$("ul").on('click','li',function(){
		$("#ss1").val($(this).text());
	})

	//text内容清空按钮
	$("#ss1").on('keyup',function(){
		var words = $(this).val();
		console.log(words);
		if(words != ''){
			$(".clear").show();
		}
		else{
			$(".clear").hide();
		}
		
	})
	$(".clear").click(function(){
		$("#ss1").val("");
		$(".clear").css("display","none");
	})
})