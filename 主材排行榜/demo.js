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
	// $(document).bind("click",function(e){
	// 	var target = $(e.target);
	// if(target.closest("#test").length == 0){
	// $("#test").hide();
	// }
	// }) 
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

	// 历史记录搜索
	$("li").click(function(){
		$(".ss1").val($(this).text());
	})

	//历史记录功能实现
	$(".imgss").click(function(){
		append();
	})
	function  append(){
		var has = false;
		$(".ls li").each(function(){
			if(this.innerHTML ==$(".ss1").val()){
				has = true;
			}
		});
		if(!has){
			$(".ls").append("<li>"+$(".ss1").val()+"</li>");
		}
	}


	//text内容清空按钮
	$(".ss1").on('keyup',function(){
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
		$(".ss1").val("");
		$(".clear").css("display","none");
	})
})